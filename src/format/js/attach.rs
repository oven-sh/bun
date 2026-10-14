//! Which node each comment belongs to.
//!
//! This is Prettier's `attachComments` (`src/main/comments/attach.js`) and the handlers of its ESTree printer
//! (`src/language-js/comments/`), function by function and under the same names, so the two can be read side by side.
//! It runs once, before anything is printed. After it every comment has exactly one owner and is leading, trailing or
//! dangling there.
//!
//! The tree is [`bun_lint::estree`], which has the nodes and ranges of typescript-estree. Prettier reads JavaScript with
//! Babel, whose tree differs in a few ways that matter here. [`Tree`] hides them:
//! - A method has its parameters and its body itself. There is no `FunctionExpression` in it.
//! - The parentheses after `/** @type {T} */` are a node, `ParenthesizedExpression`.
//! - A comment outside of every statement is in the `Program`. With typescript-estree it is in nothing.

use super::comments::Comment;
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::estree::{Field, NodeType as T, PackedVNode, VNode};
use bun_lint::span::Span;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Position {
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

const NOT_A_CAST: u32 = u32::MAX;

/// A node of the tree that Prettier has.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct EsNode<'a> {
    node: VNode<'a>,
    /// That of `node`.
    ty: T,
    /// Where the `(` is, if this is the `ParenthesizedExpression` around `node` and not `node`.
    cast: u32,
}

/// An [`EsNode`] without the reference to the file.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(crate) struct Owner {
    node: PackedVNode,
    cast: u32,
}

impl EsNode<'_> {
    fn owner(self) -> Owner {
        Owner {
            node: self.node.packed(),
            cast: self.cast,
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Attachment {
    pub(crate) owner: Owner,
    pub(crate) position: Position,
    pub(crate) marker: Marker,
    /// Prettier's `comment.unignore`: it says `prettier-ignore`, and what it is about is not its owner.
    pub(crate) is_unignored: bool,
}

#[derive(Default)]
pub(crate) struct Attached {
    /// One for each comment, in the same order.
    pub(crate) attachments: Vec<Attachment>,
    /// Prettier's `node.prettierIgnore`: nodes that are ignored without owning the comment that says so.
    pub(crate) ignored: Vec<Owner>,
}

#[derive(Copy, Clone)]
pub(crate) struct Options {
    pub(crate) has_tree_of_babel: bool,
    pub(crate) experimental_ternaries: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Placement {
    OwnLine,
    EndOfLine,
    Remaining,
}

#[derive(Copy, Clone)]
struct Child<'a> {
    node: EsNode<'a>,
    span: Span,
}

#[derive(Copy, Clone, Default)]
struct Decorated<'a> {
    enclosing: Option<EsNode<'a>>,
    preceding: Option<EsNode<'a>>,
    following: Option<EsNode<'a>>,
}

/// Prettier's `CommentContext`.
#[derive(Copy, Clone)]
struct Context<'a> {
    comment: Comment,
    enclosing: Option<EsNode<'a>>,
    preceding: Option<EsNode<'a>>,
    following: Option<EsNode<'a>>,
    placement: Placement,
    is_last_comment: bool,
}

type Handled<'a> = Option<(EsNode<'a>, Position, Marker)>;

#[expect(clippy::unnecessary_wraps)]
fn leading(node: EsNode<'_>) -> Handled<'_> {
    Some((node, Position::Leading, Marker::None))
}

#[expect(clippy::unnecessary_wraps)]
fn trailing(node: EsNode<'_>) -> Handled<'_> {
    Some((node, Position::Trailing, Marker::None))
}

#[expect(clippy::unnecessary_wraps)]
fn dangling(node: EsNode<'_>) -> Handled<'_> {
    Some((node, Position::Dangling, Marker::None))
}

/// The tree, the text and the comments: everything that is only read.
struct Tree<'a, 'c> {
    file: &'a File<'a>,
    text: &'a [u8],
    comments: &'c [Comment],
    options: Options,
    /// Where the `(` are that follow a type cast comment, if they are nodes.
    cast_parentheses: Vec<u32>,
    /// There is an `@` somewhere.
    may_have_decorators: bool,
}

// ───────────────────────────── the text ─────────────────────────────

/// The length of the line break that `text` ends with.
fn newline_len_back(text: &[u8]) -> usize {
    match text {
        [.., b'\n' | b'\r'] => 1,
        [.., 0xE2, 0x80, 0xA8 | 0xA9] => 3,
        _ => 0,
    }
}

fn starts_with_newline(text: &[u8]) -> bool {
    matches!(text, [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..])
}

fn is_blank(b: u8) -> bool {
    matches!(b, b' ' | b'\t')
}

impl<'a> Tree<'a, '_> {
    fn slice(&self, start: u32, end: u32) -> &'a [u8] {
        self.text
            .get(start as usize..end as usize)
            .unwrap_or_default()
    }

    /// `hasNewline(text, start, { backwards: true })`
    fn has_newline_before(&self, start: u32) -> bool {
        let before = self.slice(0, start);
        let blanks = before.iter().rev().take_while(|b| is_blank(**b)).count();
        newline_len_back(&before[..before.len() - blanks]) != 0
    }

    /// `hasNewline(text, end)`
    fn has_newline_after(&self, end: u32) -> bool {
        let after = self.text.get(end as usize..).unwrap_or_default();
        let blanks = after.iter().take_while(|b| is_blank(**b)).count();
        starts_with_newline(&after[blanks..])
    }

    fn has_newline_in_range(&self, start: u32, end: u32) -> bool {
        strings::contains_char(self.slice(start, end), b'\n')
    }

    /// `isAllEmptyAndNoLineBreak`. A `\r` is not a line break to it.
    fn is_all_empty_and_no_line_break(&self, start: u32, end: u32) -> bool {
        let between = self.slice(start, end);
        !strings::contains_char(between, b'\n')
            && strings::trim_js_whitespace_start(between).is_empty()
            && !strings::contains(between, b"\xE2\x80\xA8")
            && !strings::contains(between, b"\xE2\x80\xA9")
    }

    /// The comment that `at` is in.
    fn comment_around(&self, at: u32) -> Option<&Comment> {
        let index = self.comments.partition_point(|it| it.span.end <= at);
        self.comments.get(index).filter(|it| it.span.start <= at)
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

    /// Where the text ends that is before `at`, without the whitespace and the comments at its end. Not before `floor`.
    fn end_of_code_before(&self, mut at: u32, floor: u32) -> u32 {
        loop {
            at = floor + strings::trim_js_whitespace_end(self.slice(floor, at)).len() as u32;
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
                .and_then(|it| strings::index_of(it, needle))
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
        let mut end = (from as usize + needle.len()).min(self.text.len());
        loop {
            let Some(found) = self
                .text
                .get(..end)
                .and_then(|it| strings::last_index_of(it, needle))
            else {
                return -1;
            };
            match self.comment_around(found as u32) {
                Some(comment) => end = comment.span.start as usize,
                None => return found as i64,
            }
        }
    }

    /// `stripComments(options).slice(start, end).trim()`, if that is one word.
    fn only_code_between(&self, start: u32, end: u32) -> &'a [u8] {
        let start = self.next_character_index(start).min(end);
        self.slice(start, self.end_of_code_before(end, start))
    }

    fn is_single_line_block_comment(&self, comment: Comment) -> bool {
        comment.is_block() && !self.has_newline_in_range(comment.span.start, comment.span.end)
    }

    fn is_single_line_comment(&self, comment: Comment) -> bool {
        comment.is_line() || self.is_single_line_block_comment(comment)
    }
}

// ───────────────────────────── the tree ─────────────────────────────

impl<'a> Tree<'a, '_> {
    fn is_babel(&self) -> bool {
        self.options.has_tree_of_babel
    }

    fn program(&self) -> EsNode<'a> {
        EsNode {
            node: VNode::program(self.file),
            ty: T::Program,
            cast: NOT_A_CAST,
        }
    }

    /// `None` for a `ParenthesizedExpression`.
    #[inline]
    fn ty(&self, node: EsNode<'a>) -> Option<T> {
        (node.cast == NOT_A_CAST).then_some(node.ty)
    }

    #[inline]
    fn is(&self, node: Option<EsNode<'a>>, ty: T) -> bool {
        node.is_some_and(|node| self.ty(node) == Some(ty))
    }

    /// The outermost of the parentheses around `node` that are a node and are inside the one that opens at `outer`.
    fn cast_around(&self, node: VNode<'a>, outer: Option<u32>) -> u32 {
        if self.cast_parentheses.is_empty() {
            return NOT_A_CAST;
        }
        let Some(e) = node.expr_in_parentheses().filter(|e| e.is_parenthesized()) else {
            return NOT_A_CAST;
        };
        e.parens()
            .rev()
            .map(|it| it.start)
            .filter(|open| outer.is_none_or(|outer| *open > outer))
            .find(|open| self.cast_parentheses.binary_search(open).is_ok())
            .unwrap_or(NOT_A_CAST)
    }

    /// What Prettier has where typescript-estree has `node`.
    fn wrap(&self, mut node: VNode<'a>) -> EsNode<'a> {
        let mut ty = node.node_type();
        // `postprocess` takes a union or an intersection of one type out of the tree.
        while let Some(only) = only_type_of(node, ty) {
            (node, ty) = (only, only.node_type());
        }
        EsNode {
            node,
            ty,
            cast: self.cast_around(node, None),
        }
    }

    fn child(&self, node: EsNode<'a>, field: Field) -> Option<EsNode<'a>> {
        match node.cast {
            NOT_A_CAST => node.node.child(node.ty, field).map(|it| self.wrap(it)),
            _ => None,
        }
    }

    fn list(&self, node: EsNode<'a>, field: Field) -> impl Iterator<Item = EsNode<'a>> {
        let nodes = (node.cast == NOT_A_CAST).then(|| node.node.children(node.ty, field));
        nodes
            .into_iter()
            .flatten()
            .flatten()
            .map(|it| self.wrap(it))
    }

    fn parent(&self, node: EsNode<'a>) -> Option<EsNode<'a>> {
        let mut parent = node.node.parent()?;
        let mut ty = parent.node_type();
        while only_type_of(parent, ty).is_some() {
            parent = parent.parent()?;
            ty = parent.node_type();
        }
        Some(EsNode {
            node: parent,
            ty,
            cast: NOT_A_CAST,
        })
    }

    fn cast_span(&self, node: EsNode<'a>) -> Option<Span> {
        let e = node.node.expr_in_parentheses()?;
        e.parens().find(|it| it.start == node.cast)
    }

    fn loc_start(&self, node: EsNode<'a>) -> u32 {
        let Some(ty) = self.ty(node) else {
            return node.cast;
        };
        if ty == T::Program {
            return 0;
        }
        self.loc_start_from(node, ty, node.node.span().start)
    }

    /// `start`: where its range starts.
    fn loc_start_from(&self, node: EsNode<'a>, ty: T, start: u32) -> u32 {
        if !self.may_have_decorators {
            return start;
        }
        let decorated = match ty {
            T::ExportNamedDeclaration | T::ExportDefaultDeclaration => {
                match node.node.child(ty, Field::Declaration) {
                    Some(declaration) => (declaration, declaration.node_type()),
                    None => return start,
                }
            }
            T::ClassDeclaration
            | T::ClassExpression
            | T::MethodDefinition
            | T::TSAbstractMethodDefinition
            | T::PropertyDefinition
            | T::TSAbstractPropertyDefinition
            | T::AccessorProperty
            | T::TSAbstractAccessorProperty
            | T::TSParameterProperty
            | T::Identifier
            | T::ObjectPattern
            | T::ArrayPattern
            | T::AssignmentPattern
            | T::RestElement => (node.node, ty),
            _ => return start,
        };
        match decorated
            .0
            .children(decorated.1, Field::Decorators)
            .flatten()
            .next()
        {
            Some(first) => first.span().start.min(start),
            None => start,
        }
    }

    fn loc_end(&self, mut node: EsNode<'a>) -> u32 {
        loop {
            let Some(ty) = self.ty(node) else {
                return self.cast_span(node).map_or(node.cast, |it| it.end);
            };
            let span = node.node.span();
            let inner = match ty {
                T::Program => return self.text.len() as u32,
                T::IfStatement => (self.child(node, Field::Alternate))
                    .or_else(|| self.child(node, Field::Consequent)),
                T::ForInStatement
                | T::ForOfStatement
                | T::ForStatement
                | T::LabeledStatement
                | T::WithStatement
                | T::WhileStatement => self.child(node, Field::Body),
                T::VariableDeclaration => self.list(node, Field::Declarations).last(),
                T::BreakStatement | T::ContinueStatement => match self.child(node, Field::Label) {
                    Some(label) => Some(label),
                    None if ty == T::BreakStatement => return span.start + 5,
                    None => return span.start + 8,
                },
                T::DebuggerStatement => return span.start + 8,
                T::ExpressionStatement
                | T::ImportDeclaration
                | T::ExportDefaultDeclaration
                | T::ExportNamedDeclaration
                | T::ExportAllDeclaration
                | T::ReturnStatement
                | T::ThrowStatement
                | T::DoWhileStatement => return self.content_end(span),
                _ => return span.end,
            };
            match inner {
                Some(inner) => node = inner,
                None => return span.end,
            }
        }
    }

    /// `setContentEnd`: where a statement ends without its `;`.
    fn content_end(&self, span: Span) -> u32 {
        match self.slice(span.start, span.end) {
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

    fn loc(&self, node: EsNode<'a>) -> Span {
        Span::new(self.loc_start(node), self.loc_end(node))
    }

    fn is_method(&self, node: EsNode<'a>) -> bool {
        match node.node.string(node.ty, Field::Kind) {
            Some(b"init") => node.node.is_true(node.ty, Field::Method),
            Some(b"get" | b"set") => true,
            _ => false,
        }
    }

    /// Babel's `ClassPrivateMethod` and `ClassPrivateProperty`, which none of Prettier's lists of types have.
    fn is_private_member_of_babel(&self, node: EsNode<'a>) -> bool {
        self.is_babel() && self.is(self.child(node, Field::Key), T::PrivateIdentifier)
    }

    /// `node` is a method, whose `value` is a function that only typescript-estree has.
    fn has_function_as_value(&self, node: EsNode<'a>) -> bool {
        match self.ty(node) {
            Some(T::MethodDefinition | T::TSAbstractMethodDefinition) => true,
            Some(T::Property) => self.is_method(node),
            _ => false,
        }
    }

    /// The node that has the parameters and the body of `node`, which is a function or a method.
    fn function_of(&self, node: EsNode<'a>) -> EsNode<'a> {
        match self.ty(node) {
            Some(T::MethodDefinition | T::TSAbstractMethodDefinition) => {
                self.child(node, Field::Value).unwrap_or(node)
            }
            Some(T::Property) if self.is_method(node) => {
                self.child(node, Field::Value).unwrap_or(node)
            }
            _ => node,
        }
    }

    fn has_parameters(&self, function: EsNode<'a>) -> bool {
        self.list(self.function_of(function), Field::Params)
            .next()
            .is_some()
    }

    fn is_directive(&self, node: EsNode<'a>) -> bool {
        self.ty(node) == Some(T::ExpressionStatement)
            && node.node.string(node.ty, Field::Directive).is_some()
    }

    fn can_attach_comment(&self, node: EsNode<'a>) -> bool {
        match node.ty {
            T::FunctionExpression
            | T::Identifier
            | T::Literal
            | T::TSTypeReference
            | T::EmptyStatement
            | T::TSTypeAnnotation => self.can_attach_comment_in(node, self.parent(node)),
            _ => self.can_attach_comment_in(node, None),
        }
    }

    /// `parent`: that of `node`.
    fn can_attach_comment_in(&self, node: EsNode<'a>, parent: Option<EsNode<'a>>) -> bool {
        let Some(ty) = self.ty(node) else {
            return true;
        };
        let parent = || parent;
        let parent_type = || parent().and_then(|it| self.ty(it));
        match ty {
            T::TemplateElement | T::TSEmptyBodyFunctionExpression | T::ChainExpression => false,
            T::FunctionExpression if self.is_babel() => {
                !parent().is_some_and(|it| self.has_function_as_value(it))
            }
            // `isClassMethodCantAttachComment`
            T::FunctionExpression => {
                parent_type() != Some(T::MethodDefinition)
                    || self.has_parameters(node)
                    || self.child(node, Field::ReturnType).is_some()
                    || self.child(node, Field::Body).is_none()
            }
            // `isChildWontPrint`, `isTsAsConst`
            T::Identifier | T::Literal => {
                let Some(parent) = parent() else {
                    return true;
                };
                let is = |field: Field| self.child(parent, field) == Some(node);
                let has_same_span = |a: Field, b: Field| {
                    let span = |field| self.child(parent, field).map(|it| it.node.span());
                    span(a) == span(b)
                };
                match self.ty(parent) {
                    Some(T::Property) => {
                        !(parent.node.is_true(parent.ty, Field::Shorthand)
                            && is(Field::Key)
                            && !self.is_method(parent)
                            && !is(Field::Value))
                    }
                    Some(T::ImportSpecifier) => {
                        !(is(Field::Local)
                            && !is(Field::Imported)
                            && has_same_span(Field::Local, Field::Imported))
                    }
                    Some(T::ExportSpecifier) => {
                        !(is(Field::Exported)
                            && !is(Field::Local)
                            && has_same_span(Field::Local, Field::Exported))
                    }
                    Some(T::TSTypeReference) => !self.is_as_const_type(parent, self.parent(parent)),
                    _ => true,
                }
            }
            T::TSTypeReference => !self.is_as_const_type(node, parent()),
            // `isMeaningfulEmptyStatement`
            T::EmptyStatement => parent().is_some_and(|parent| match self.ty(parent) {
                Some(T::IfStatement) => {
                    self.child(parent, Field::Consequent) == Some(node)
                        || self.child(parent, Field::Alternate) == Some(node)
                }
                Some(
                    T::DoWhileStatement
                    | T::ForInStatement
                    | T::ForOfStatement
                    | T::ForStatement
                    | T::LabeledStatement
                    | T::WithStatement
                    | T::WhileStatement,
                ) => self.child(parent, Field::Body) == Some(node),
                _ => false,
            }),
            T::TSTypeAnnotation => parent_type() != Some(T::TSPropertySignature),
            _ => true,
        }
    }

    /// `node`, which is in `parent`, is the `const` of `a as const`.
    fn is_as_const_type(&self, node: EsNode<'a>, parent: Option<EsNode<'a>>) -> bool {
        parent.is_some_and(|parent| {
            self.ty(parent) == Some(T::TSAsExpression)
                && self.file.slice(node.node.span()) == b"const"
                && self.child(parent, Field::TypeAnnotation) == Some(node)
        })
    }

    /// `getSortedChildNodes`, without the sorting, and of a long list only what is next to `comment`: `margin` elements
    /// on either side. Returns whether that will do: on each side where something has been left out, there is a child that
    /// is closer to the comment.
    fn push_children(
        &self,
        node: EsNode<'a>,
        comment: Span,
        margin: u32,
        children: &mut Vec<Child<'a>>,
    ) -> bool {
        if node.cast != NOT_A_CAST {
            let inner = EsNode {
                cast: self.cast_around(node.node, Some(node.cast)),
                ..node
            };
            return self.push_child(inner, node, comment, margin, children);
        }
        let mut is_enough = true;
        node.node
            .for_each_field_of_children(node.ty, |field| match field {
                Ok(child) => {
                    is_enough &= self.push_child(self.wrap(child), node, comment, margin, children);
                }
                Err(mut list) => {
                    let (is_cut_at_front, is_cut_at_back) = list.narrow_to(comment.start, margin);
                    let first = children.len();
                    for child in list.flatten() {
                        is_enough &=
                            self.push_child(self.wrap(child), node, comment, margin, children);
                    }
                    let pushed = children.get(first..).unwrap_or_default();
                    let has = |is_closer: &dyn Fn(Span) -> bool| {
                        pushed
                            .iter()
                            .any(|it| it.span.contains(comment) || is_closer(it.span))
                    };
                    is_enough &= !is_cut_at_front || has(&|span| span.end <= comment.start);
                    is_enough &= !is_cut_at_back || has(&|span| span.start >= comment.end);
                }
            });
        is_enough
    }

    fn push_child(
        &self,
        child: EsNode<'a>,
        parent: EsNode<'a>,
        comment: Span,
        margin: u32,
        children: &mut Vec<Child<'a>>,
    ) -> bool {
        if !self.can_attach_comment_in(child, Some(parent)) {
            return self.push_children(child, comment, margin, children);
        }
        let start = self.loc_start(child);
        // Where something ends that starts behind the comment makes no difference.
        let end = match start >= comment.end {
            true => start,
            false => self.loc_end(child),
        };
        children.push(Child {
            node: child,
            span: Span::new(start, end),
        });
        true
    }
}

/// The one type of a union or an intersection that has only one: `| A`.
#[inline]
fn only_type_of(node: VNode<'_>, ty: T) -> Option<VNode<'_>> {
    if !matches!(ty, T::TSUnionType | T::TSIntersectionType) {
        return None;
    }
    let mut types = node.children(ty, Field::Types).flatten();
    types.next().filter(|_| types.next().is_none())
}

// ───────────────────────────── kinds of nodes ─────────────────────────────

impl<'a> Tree<'a, '_> {
    fn is_union_type(&self, node: Option<EsNode<'a>>) -> bool {
        self.is(node, T::TSUnionType)
    }

    fn is_conditional(&self, node: Option<EsNode<'a>>) -> bool {
        self.is(node, T::ConditionalExpression) || self.is(node, T::TSConditionalType)
    }

    fn is_class_like(&self, node: EsNode<'a>) -> bool {
        matches!(
            self.ty(node),
            Some(T::ClassDeclaration | T::ClassExpression | T::TSInterfaceDeclaration)
        )
    }

    fn is_property_like(&self, node: Option<EsNode<'a>>) -> bool {
        node.is_some_and(|node| {
            matches!(
                self.ty(node),
                Some(
                    T::PropertyDefinition
                        | T::TSAbstractPropertyDefinition
                        | T::TSAbstractMethodDefinition
                        | T::MethodDefinition
                        | T::AccessorProperty
                        | T::TSAbstractAccessorProperty
                        | T::TSParameterProperty
                )
            ) && !self.is_private_member_of_babel(node)
        })
    }

    fn is_function_like(&self, node: EsNode<'a>) -> bool {
        match self.ty(node) {
            Some(T::FunctionDeclaration | T::FunctionExpression) => true,
            Some(T::MethodDefinition) => !self.is_private_member_of_babel(node),
            Some(T::Property) => self.is_babel() && self.is_method(node),
            _ => false,
        }
    }

    fn is_real_function_like(&self, node: EsNode<'a>) -> bool {
        match self.ty(node) {
            Some(
                T::ArrowFunctionExpression
                | T::FunctionExpression
                | T::FunctionDeclaration
                | T::TSDeclareFunction
                | T::TSCallSignatureDeclaration
                | T::TSConstructSignatureDeclaration
                | T::TSMethodSignature
                | T::TSConstructorType
                | T::TSFunctionType,
            ) => true,
            Some(T::MethodDefinition | T::TSAbstractMethodDefinition) => {
                self.is_babel() && !self.is_private_member_of_babel(node)
            }
            Some(T::Property) => self.is_babel() && self.is_method(node),
            _ => false,
        }
    }

    fn is_object_property(&self, node: EsNode<'a>) -> bool {
        self.ty(node) == Some(T::Property) && !self.is_method(node)
    }

    fn is_binary_cast_expression(&self, node: EsNode<'a>) -> bool {
        matches!(
            self.ty(node),
            Some(T::TSAsExpression | T::TSSatisfiesExpression)
        )
    }

    /// The statements of a block or the members of the body of a class or an interface. Babel has the directives
    /// somewhere else.
    fn body_of(&self, node: EsNode<'a>) -> impl Iterator<Item = EsNode<'a>> {
        let field = match self.ty(node) {
            Some(T::TSTypeLiteral) => Field::Members,
            _ => Field::Body,
        };
        self.list(node, field)
            .filter(|it| !(self.is_babel() && self.is_directive(*it)))
    }

    fn add_block_statement_first_comment(&self, node: EsNode<'a>) -> Handled<'a> {
        match self
            .body_of(node)
            .find(|it| self.ty(*it) != Some(T::EmptyStatement))
        {
            Some(first) => leading(first),
            None => dangling(node),
        }
    }

    fn add_block_or_not_comment(&self, node: EsNode<'a>) -> Handled<'a> {
        match self.ty(node) {
            Some(T::BlockStatement) => self.add_block_statement_first_comment(node),
            _ => leading(node),
        }
    }
}

// ───────────────────────────── attach.js ─────────────────────────────

struct Attacher<'a, 'c> {
    tree: Tree<'a, 'c>,
    /// Nodes that the last comment was in, each in the one before. The first is the `Program`, the last is the innermost.
    /// The next comment is behind it, so a node that is left is never come back to.
    path: Vec<Child<'a>>,
    /// The children of a node that are next to the comment at hand.
    children: Vec<Child<'a>>,
    decorated: Vec<Decorated<'a>>,
    attached: Attached,
    is_unignored: bool,
    is_program_empty: bool,
    /// From the end of what precedes the last comment to the start of what follows it. Every comment in there has the same
    /// nodes around it.
    gap: Span,
}

/// Attaches `comments`, which are those of `file` in the order of the source.
pub(crate) fn attach<'a>(file: &'a File<'a>, comments: &[Comment], options: Options) -> Attached {
    if comments.is_empty() {
        return Attached::default();
    }
    let text = file.text();
    let cast_parentheses = (comments.iter())
        .filter(|comment| comment.is_type_cast())
        .filter_map(|comment| {
            let after = text.get(comment.span.end as usize..)?;
            let after = strings::trim_js_whitespace_start(after);
            (after.starts_with(b"(")).then(|| (text.len() - after.len()) as u32)
        })
        .collect();
    let tree = Tree {
        file,
        text,
        comments,
        options,
        cast_parentheses,
        may_have_decorators: strings::contains_char(text, b'@'),
    };
    let is_program_empty = tree.list(tree.program(), Field::Body).next().is_none();
    let mut attacher = Attacher {
        tree,
        path: Vec::new(),
        children: Vec::new(),
        decorated: Vec::with_capacity(comments.len()),
        attached: Attached::default(),
        is_unignored: false,
        is_program_empty,
        gap: Span::default(),
    };
    attacher.run();
    attacher.attached
}

impl<'a> Attacher<'a, '_> {
    /// The children of `node` that are next to `comment`, sorted.
    fn list_children(&mut self, node: EsNode<'a>, comment: Span) {
        for margin in [1, u32::MAX] {
            self.children.clear();
            if self
                .tree
                .push_children(node, comment, margin, &mut self.children)
            {
                break;
            }
        }
        if !self
            .children
            .is_sorted_by_key(|it| (it.span.start, it.span.end))
        {
            crate::sort::sort_by_key(&mut self.children, |it| (it.span.start, it.span.end));
        }
    }

    /// A node in `child` that `comment` is in too, further down.
    fn descendant_around(&self, child: Child<'a>, comment: Span) -> Option<Child<'a>> {
        let tree = &self.tree;
        let mut node = tree.wrap(child.node.node.descendant_around(comment)?);
        node.cast = NOT_A_CAST;
        while !tree.can_attach_comment(node) {
            node = tree.parent(node)?;
        }
        let span = tree.loc(node);
        (span.contains(comment) && child.span.contains(span) && node != child.node)
            .then_some(Child { node, span })
    }

    fn decorate_comment(&mut self, comment: Span) -> Decorated<'a> {
        if self.gap.contains(comment)
            && let Some(last) = self.decorated.last()
        {
            return *last;
        }
        while self.path.len() > 1
            && let Some(last) = self.path.last()
            && !last.span.contains(comment)
        {
            self.path.pop();
        }
        if let Some(last) = self.path.last()
            && let Some(further) = self.descendant_around(*last, comment)
        {
            self.path.push(further);
        }
        loop {
            let Some(level) = self.path.last().copied() else {
                return Decorated::default();
            };
            self.list_children(level.node, comment);
            let children = &self.children;
            let (mut preceding, mut following, mut inner) = (None, None, None);
            let (mut left, mut right) = (0, children.len());
            while left < right {
                let middle = (left + right) >> 1;
                let Some(child) = children.get(middle) else {
                    break;
                };
                if child.span.contains(comment) {
                    inner = Some(*child);
                    break;
                }
                if child.span.end <= comment.start {
                    preceding = Some(*child);
                    left = middle + 1;
                } else if comment.end <= child.span.start {
                    following = Some(*child);
                    right = middle;
                } else {
                    // "Comment location overlaps with node location"
                    break;
                }
            }
            if let Some(inner) = inner {
                self.path.push(inner);
                continue;
            }
            let is_outside_of_all = self.path.len() == 1 && !self.tree.is_babel();
            let enclosing = (!is_outside_of_all).then_some(level.node);
            self.gap = Span::new(
                preceding.map_or(level.span.start, |it| it.span.end),
                following.map_or(level.span.end, |it| it.span.start),
            );
            let (mut preceding, mut following) =
                (preceding.map(|it| it.node), following.map(|it| it.node));
            // A comment in one `${}` of a template does not move to another.
            if self.tree.is(enclosing, T::TemplateLiteral) {
                self.gap = Span::default();
                let quasis: Vec<u32> = (self.tree.list(level.node, Field::Quasis))
                    .map(|it| it.node.span().start + 1)
                    .collect();
                let expression_index = |start: u32| {
                    (quasis.iter().skip(1))
                        .position(|quasi| start <= *quasi)
                        .unwrap_or(0)
                };
                let is_in_same = |node: &EsNode<'a>| {
                    expression_index(self.tree.loc_start(*node)) == expression_index(comment.start)
                };
                preceding = preceding.filter(is_in_same);
                following = following.filter(is_in_same);
            }
            return Decorated {
                enclosing,
                preceding,
                following,
            };
        }
    }

    fn is_own_line_comment(&self, index: usize) -> bool {
        let (comments, tree) = (self.tree.comments, &self.tree);
        let mut start = comments[index].span.start;
        let preceding = self.decorated[index].preceding;
        if preceding.is_some() {
            for before in (0..index).rev() {
                if self.decorated[before].preceding != preceding
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
        let following = self.decorated[index].following;
        if following.is_some() {
            for after in index + 1..comments.len() {
                if self.decorated[after].following != following
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
        self.path.push(Child {
            node: program,
            span: Span::new(0, self.tree.text.len() as u32),
        });
        for comment in comments {
            let decorated = self.decorate_comment(comment.span);
            self.decorated.push(decorated);
        }
        let nowhere = Attachment {
            owner: program.owner(),
            position: Position::Dangling,
            marker: Marker::None,
            is_unignored: false,
        };
        self.attached.attachments = vec![nowhere; comments.len()];

        let mut ties_to_break: Vec<usize> = Vec::new();
        for (index, comment) in comments.iter().enumerate() {
            let Decorated {
                enclosing,
                preceding,
                following,
            } = self.decorated[index];
            let placement = if self.is_own_line_comment(index) {
                Placement::OwnLine
            } else if self.is_end_of_line_comment(index) {
                Placement::EndOfLine
            } else {
                Placement::Remaining
            };
            let context = Context {
                comment: *comment,
                enclosing,
                preceding,
                following,
                placement,
                is_last_comment: index + 1 == comments.len(),
            };
            self.is_unignored = false;
            let handled = match placement {
                _ if self.is_between_elements(&context) => None,
                Placement::OwnLine => self.handle_own_line_comment(&context),
                Placement::EndOfLine => self.handle_end_of_line_comment(&context),
                Placement::Remaining => self.handle_remaining_comment(&context),
            };
            let in_enclosing = || dangling(enclosing.unwrap_or(program));
            let handled = handled.or_else(|| match placement {
                Placement::OwnLine => (following.and_then(leading))
                    .or_else(|| preceding.and_then(trailing))
                    .or_else(in_enclosing),
                Placement::EndOfLine => (preceding.and_then(trailing))
                    .or_else(|| following.and_then(leading))
                    .or_else(in_enclosing),
                Placement::Remaining if preceding.is_some() && following.is_some() => None,
                Placement::Remaining => (preceding.and_then(trailing))
                    .or_else(|| following.and_then(leading))
                    .or_else(in_enclosing),
            });
            match handled {
                Some(handled) => self.set(index, handled),
                None => {
                    if let Some(last) = ties_to_break.last()
                        && self.decorated[*last].following != following
                    {
                        self.break_ties(&mut ties_to_break);
                    }
                    self.attached.attachments[index].is_unignored = self.is_unignored;
                    ties_to_break.push(index);
                }
            }
        }
        self.break_ties(&mut ties_to_break);
    }

    /// The comment is directly in a list of statements, members, properties or elements. That is most comments, and no
    /// handler has anything to say about one: each asks for another kind of node around the comment, or for a type next to it.
    fn is_between_elements(&self, c: &Context<'a>) -> bool {
        let is_in_list = c.enclosing.is_none_or(|enclosing| {
            matches!(
                self.tree.ty(enclosing),
                Some(
                    T::Program
                        | T::BlockStatement
                        | T::StaticBlock
                        | T::ClassBody
                        | T::TSInterfaceBody
                        | T::TSModuleBlock
                        | T::TSTypeLiteral
                        | T::TSEnumBody
                        | T::ObjectExpression
                        | T::ArrayExpression
                )
            )
        });
        is_in_list && !c.comment.looks_like_type_cast() && !self.is_program_empty
    }

    fn set(&mut self, index: usize, (node, position, marker): (EsNode<'a>, Position, Marker)) {
        self.attached.attachments[index] = Attachment {
            owner: node.owner(),
            position,
            marker,
            is_unignored: self.is_unignored,
        };
    }

    fn break_ties(&mut self, ties_to_break: &mut Vec<usize>) {
        let Some(first) = ties_to_break.first() else {
            return;
        };
        let Decorated {
            preceding: Some(preceding),
            following: Some(following),
            ..
        } = self.decorated[*first]
        else {
            ties_to_break.clear();
            return;
        };
        let mut gap_end = self.tree.loc_start(following);
        let mut first_leading = ties_to_break.len();
        while first_leading > 0 {
            let comment = self.tree.comments[ties_to_break[first_leading - 1]];
            let gap = self.tree.slice(comment.span.end, gap_end);
            let is_gap = strings::split(gap, b"(")
                .all(|it| strings::trim_js_whitespace_start(it).is_empty());
            if !is_gap {
                break;
            }
            gap_end = comment.span.start;
            first_leading -= 1;
        }
        for (i, index) in ties_to_break.iter().enumerate() {
            let attachment = &mut self.attached.attachments[*index];
            (attachment.owner, attachment.position) = match i < first_leading {
                true => (preceding.owner(), Position::Trailing),
                false => (following.owner(), Position::Leading),
            };
        }
        ties_to_break.clear();
    }
}

// ───────────────────────────── handle-comments.js ─────────────────────────────

impl<'a> Attacher<'a, '_> {
    fn handle_own_line_comment(&mut self, c: &Context<'a>) -> Handled<'a> {
        self.handle_comment_in_empty_parens(c)
            .or_else(|| self.handle_ignore_comments(c))
            .or_else(|| self.handle_closure_type_cast_comments(c))
            .or_else(|| self.handle_conditional_expression_comments(c))
            .or_else(|| self.handle_last_function_parameter_comments(c))
            .or_else(|| self.handle_member_expression_comments(c))
            .or_else(|| self.handle_if_statement_comments(c))
            .or_else(|| self.handle_while_like_comments(c))
            .or_else(|| self.handle_switch_statement_comments(c))
            .or_else(|| self.handle_try_statement_comments(c))
            .or_else(|| self.handle_class_comments(c))
            .or_else(|| self.handle_for_x_statement_comments(c))
            .or_else(|| self.handle_union_type_comments(c))
            .or_else(|| self.handle_only_comments(c))
            .or_else(|| self.handle_module_specifiers_comments(c))
            .or_else(|| self.handle_assignment_pattern_comments(c))
            .or_else(|| self.handle_method_name_comments(c))
            .or_else(|| self.handle_labeled_statement_comments(c))
            .or_else(|| self.handle_nested_conditional_expression_comments(c))
            .or_else(|| self.handle_comments_in_destructuring_pattern(c))
            .or_else(|| self.handle_ts_mapped_type_comments(c))
            .or_else(|| self.handle_binary_cast_expression_comment(c))
            .or_else(|| self.handle_union_type_leading_comments(c))
            .or_else(|| self.handle_sequence_expression_leading_comment(c))
    }

    fn handle_end_of_line_comment(&mut self, c: &Context<'a>) -> Handled<'a> {
        self.handle_comment_in_empty_parens(c)
            .or_else(|| self.handle_closure_type_cast_comments(c))
            .or_else(|| self.handle_last_function_parameter_comments(c))
            .or_else(|| self.handle_conditional_expression_comments(c))
            .or_else(|| self.handle_module_specifiers_comments(c))
            .or_else(|| self.handle_if_statement_comments(c))
            .or_else(|| self.handle_while_like_comments(c))
            .or_else(|| self.handle_switch_statement_comments(c))
            .or_else(|| self.handle_try_statement_comments(c))
            .or_else(|| self.handle_class_comments(c))
            .or_else(|| self.handle_for_x_statement_comments(c))
            .or_else(|| self.handle_labeled_statement_comments(c))
            .or_else(|| self.handle_call_expression_comments(c))
            .or_else(|| self.handle_property_comments(c))
            .or_else(|| self.handle_only_comments(c))
            .or_else(|| self.handle_assignment_like_comments(c))
            .or_else(|| self.handle_switch_default_case_comments(c))
            .or_else(|| self.handle_last_union_element_in_expression(c))
            .or_else(|| self.handle_last_binary_operator_operand(c))
            .or_else(|| self.handle_comments_in_destructuring_pattern(c))
            .or_else(|| self.handle_ts_mapped_type_comments(c))
            .or_else(|| self.handle_arrow_expression_comments(c))
            .or_else(|| self.handle_parenthesized_expression_trailing_comment(c))
            .or_else(|| self.handle_property_signature_comments(c))
            .or_else(|| self.handle_binary_cast_expression_comment(c))
            .or_else(|| self.handle_tagged_template_expression_comments(c))
            .or_else(|| self.handle_sequence_expression_leading_comment(c))
    }

    fn handle_remaining_comment(&mut self, c: &Context<'a>) -> Handled<'a> {
        self.handle_comment_in_empty_parens(c)
            .or_else(|| self.handle_ignore_comments(c))
            .or_else(|| self.handle_closure_type_cast_comments(c))
            .or_else(|| self.handle_if_statement_comments(c))
            .or_else(|| self.handle_while_like_comments(c))
            .or_else(|| self.handle_switch_statement_comments(c))
            .or_else(|| self.handle_for_x_statement_comments(c))
            .or_else(|| self.handle_method_name_comments(c))
            .or_else(|| self.handle_only_comments(c))
            .or_else(|| self.handle_assignment_like_comments(c))
            .or_else(|| self.handle_ts_mapped_type_comments(c))
            .or_else(|| self.handle_comment_after_arrow_params(c))
            .or_else(|| self.handle_function_name_comments(c))
            .or_else(|| self.handle_ts_function_trailing_comments(c))
            .or_else(|| self.handle_parenthesized_expression_trailing_comment(c))
            .or_else(|| self.handle_property_signature_comments(c))
            .or_else(|| self.handle_binary_cast_expression_comment(c))
            .or_else(|| self.handle_union_type_leading_comments(c))
            .or_else(|| self.handle_sequence_expression_leading_comment(c))
    }

    /// `node.prettierIgnore = true; comment.unignore = true;`
    fn ignore_instead_of_owner(&mut self, node: EsNode<'a>) {
        self.attached.ignored.push(node.owner());
        self.is_unignored = true;
    }

    fn is_prettier_ignore_comment(&self, c: &Context<'a>) -> bool {
        c.comment.is_ignore_comment() && !self.is_unignored
    }

    fn handle_closure_type_cast_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let following = c.following.filter(|_| c.comment.looks_like_type_cast())?;
        let is_nullish_coalescing = tree.ty(following) == Some(T::LogicalExpression)
            && following.node.string(following.ty, Field::Operator) == Some(b"??");
        if tree.is(c.enclosing, T::ConditionalExpression) && is_nullish_coalescing {
            return leading(tree.child(following, Field::Left)?);
        }
        leading(following)
    }

    fn handle_try_statement_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, following) = (c.enclosing?, c.following?);
        let is_catch_clause = match tree.ty(enclosing) {
            Some(T::TryStatement) => false,
            Some(T::CatchClause) => true,
            _ => return None,
        };
        if is_catch_clause && let Some(preceding) = c.preceding {
            return trailing(preceding);
        }
        match tree.ty(following) {
            Some(T::BlockStatement) => tree.add_block_statement_first_comment(following),
            Some(T::TryStatement) => {
                tree.add_block_or_not_comment(tree.child(following, Field::Finalizer)?)
            }
            Some(T::CatchClause) => {
                tree.add_block_or_not_comment(tree.child(following, Field::Body)?)
            }
            _ => None,
        }
    }

    fn handle_member_expression_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let is_before_name = self.tree.is(c.enclosing, T::MemberExpression)
            && self.tree.is(c.following, T::Identifier);
        leading(c.enclosing.filter(|_| is_before_name)?)
    }

    fn handle_nested_conditional_expression_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let is_nested = tree.options.experimental_ternaries
            && tree.is_conditional(c.enclosing)
            && tree.is_conditional(c.following);
        dangling(c.enclosing.filter(|_| is_nested)?)
    }

    fn handle_conditional_expression_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        if !tree.is_conditional(c.enclosing) {
            return None;
        }
        let is_same_line_as_preceding_node = c.preceding.is_some_and(|preceding| {
            !tree.has_newline_in_range(tree.loc_end(preceding), c.comment.span.start)
        });
        if is_same_line_as_preceding_node {
            return None;
        }
        let (enclosing, following) = (c.enclosing?, c.following?);
        if tree.options.experimental_ternaries
            && tree.child(enclosing, Field::Alternate) == Some(following)
            && !tree.is_single_line_block_comment(c.comment)
        {
            return dangling(enclosing);
        }
        leading(following)
    }

    fn handle_class_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c.enclosing.filter(|it| tree.is_class_like(*it))?;
        if let Some(last) = tree.list(enclosing, Field::Decorators).last()
            && !tree.is(c.following, T::Decorator)
        {
            return trailing(last);
        }
        let body = tree.child(enclosing, Field::Body);
        if body.is_some() && c.following == body {
            return tree.add_block_statement_first_comment(body?);
        }
        let (preceding, following) = (c.preceding?, c.following?);
        let id = tree.child(enclosing, Field::Id);
        let type_parameters = tree.child(enclosing, Field::TypeParameters);
        let super_class = tree.child(enclosing, Field::SuperClass);
        let is_head = Some(preceding) == id || Some(preceding) == type_parameters;
        if Some(following) == super_class && is_head {
            return trailing(preceding);
        }
        let clauses = [
            (Field::Implements, &b"implements"[..], Marker::Implements),
            (Field::Extends, b"extends", Marker::Extends),
        ];
        for (field, keyword, marker) in clauses {
            let Some(first) = tree
                .list(enclosing, field)
                .next()
                .filter(|it| *it == following)
            else {
                continue;
            };
            if !is_head && Some(preceding) != super_class {
                return Some((enclosing, Position::Dangling, marker));
            }
            if tree.only_code_between(c.comment.span.end, tree.loc_start(first)) == keyword {
                return trailing(preceding);
            }
        }
        None
    }

    fn handle_method_name_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let next_character = || tree.next_character(c.comment.span.end);
        // Only the trees of ESTree need this: `obj = { fn /*comment*/() {} };`
        if let (Some(enclosing), Some(preceding)) = (c.enclosing, c.preceding)
            && match tree.ty(enclosing) {
                Some(T::Property) => !tree.is_babel(),
                Some(T::TSAbstractMethodDefinition) => true,
                Some(T::MethodDefinition) => {
                    tree.is_babel()
                        && tree.is(
                            tree.child(enclosing, Field::Value),
                            T::TSEmptyBodyFunctionExpression,
                        )
                }
                _ => false,
            }
            && tree.ty(preceding) == Some(T::Identifier)
            && tree.child(enclosing, Field::Key) == Some(preceding)
            && next_character() == Some(b'(')
            && tree.next_character(tree.loc_end(preceding)) != Some(b':')
        {
            return trailing(preceding);
        }
        if tree.is_property_like(c.enclosing)
            && c.following.is_none()
            && c.placement == Placement::Remaining
        {
            return match next_character() {
                Some(b'(') => trailing(c.preceding?),
                _ => trailing(c.enclosing?),
            };
        }
        if tree.is(c.preceding, T::Decorator)
            && tree.is_property_like(c.enclosing)
            && (c.comment.is_line() || c.placement == Placement::OwnLine)
        {
            return trailing(c.preceding?);
        }
        None
    }

    fn handle_function_name_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, preceding) = (c.enclosing?, c.preceding?);
        let is_before_parameters = tree.next_character(c.comment.span.end) == Some(b'(');
        (is_before_parameters && tree.is_function_like(enclosing)).then_some(())?;
        trailing(preceding)
    }

    fn handle_comment_after_arrow_params(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c
            .enclosing
            .filter(|it| tree.ty(*it) == Some(T::ArrowFunctionExpression))?;
        let index = tree.next_character_index(c.comment.span.end);
        (tree.slice(index, index + 2) == b"=>").then_some((
            enclosing,
            Position::Dangling,
            Marker::CommentBeforeArrow,
        ))
    }

    fn is_in_argument_or_parameter_parentheses(&self, node: EsNode<'a>, comment: Span) -> bool {
        let tree = &self.tree;
        comment.start < tree.loc_end(node)
            && comment.end > tree.loc_start(node)
            && tree
                .slice(0, tree.end_of_code_before(comment.start, 0))
                .ends_with(b"(")
            && tree.next_character(comment.end) == Some(b')')
    }

    fn handle_comment_in_empty_parens(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c.enclosing?;
        if matches!(
            tree.ty(enclosing),
            Some(T::CallExpression | T::NewExpression)
        ) && tree.list(enclosing, Field::Arguments).next().is_none()
            && self.is_in_argument_or_parameter_parentheses(enclosing, c.comment.span)
        {
            return dangling(enclosing);
        }
        let function = match tree.is_real_function_like(enclosing) {
            true => enclosing,
            false => Some(tree.function_of(enclosing)).filter(|it| *it != enclosing)?,
        };
        let is_in_empty_parentheses = !tree.has_parameters(function)
            && self.is_in_argument_or_parameter_parentheses(function, c.comment.span);
        dangling(is_in_empty_parentheses.then_some(function)?)
    }

    fn handle_last_function_parameter_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c.enclosing?;
        let has_no_body = || {
            matches!(
                tree.ty(enclosing),
                Some(T::TSAbstractMethodDefinition | T::MethodDefinition)
            ) && tree.is(
                tree.child(enclosing, Field::Value),
                T::TSEmptyBodyFunctionExpression,
            )
        };
        if let Some(preceding) = c.preceding
            && matches!(
                tree.ty(preceding),
                Some(
                    T::Identifier
                        | T::AssignmentPattern
                        | T::ObjectPattern
                        | T::ArrayPattern
                        | T::RestElement
                        | T::TSParameterProperty
                )
            )
            && (tree.is_real_function_like(enclosing) || has_no_body())
            && tree.next_character(c.comment.span.end) == Some(b')')
        {
            return trailing(preceding);
        }
        // Between the `)` of the parameters and the body.
        let following = c.following?;
        if !c.comment.is_block()
            && tree.ty(following) == Some(T::BlockStatement)
            && tree.is_function_like(enclosing)
            && tree.child(tree.function_of(enclosing), Field::Body) == Some(following)
            && tree.next_character_index(c.comment.span.end) == tree.loc_start(following)
        {
            return tree.add_block_statement_first_comment(following);
        }
        None
    }

    fn handle_labeled_statement_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        leading(
            c.enclosing
                .filter(|it| self.tree.ty(*it) == Some(T::LabeledStatement))?,
        )
    }

    fn handle_call_expression_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c.enclosing?;
        if !matches!(
            tree.ty(enclosing),
            Some(T::CallExpression | T::NewExpression)
        ) || tree.child(enclosing, Field::Callee) != c.preceding
        {
            return None;
        }
        let first = tree.list(enclosing, Field::Arguments).next()?;
        // `isInsideCallOrNewExpressionParentheses`
        let closing = tree.loc_end(enclosing).checked_sub(1)?;
        if tree.text.get(closing as usize) != Some(&b')') || c.comment.span.end > closing {
            return None;
        }
        let before_parenthesis = (tree.child(enclosing, Field::TypeArguments))
            .or_else(|| tree.child(enclosing, Field::Callee))?;
        let opening = tree.index_of(b"(", tree.loc_end(before_parenthesis));
        (opening != -1 && i64::from(c.comment.span.start) > opening).then_some(())?;
        leading(first)
    }

    fn handle_union_type_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        if self.tree.is_union_type(c.enclosing) {
            if self.is_prettier_ignore_comment(c)
                && let Some(following) = c.following
            {
                self.ignore_instead_of_owner(following);
            }
            return trailing(c.preceding?);
        }
        if self.tree.is_union_type(c.following) && self.is_prettier_ignore_comment(c) {
            let first = self.tree.list(c.following?, Field::Types).next()?;
            self.ignore_instead_of_owner(first);
        }
        None
    }

    fn handle_property_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        leading(c.enclosing.filter(|it| self.tree.is_object_property(*it))?)
    }

    fn handle_only_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        if !self.is_program_empty {
            return None;
        }
        let program = self.tree.program();
        match c.is_last_comment {
            true => dangling(program),
            false => leading(program),
        }
    }

    fn handle_module_specifiers_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c.enclosing?;
        let specifier = match tree.ty(enclosing) {
            Some(T::ImportSpecifier | T::ExportSpecifier) => return leading(enclosing),
            Some(T::ImportDeclaration) => T::ImportSpecifier,
            Some(T::ExportNamedDeclaration) => T::ExportSpecifier,
            _ => return None,
        };
        let ends_line =
            tree.is(c.preceding, specifier) && tree.has_newline_after(c.comment.span.end);
        trailing(c.preceding.filter(|_| ends_line)?)
    }

    fn handle_assignment_pattern_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        leading(
            c.enclosing
                .filter(|it| self.tree.ty(*it) == Some(T::AssignmentPattern))?,
        )
    }

    fn should_attach_to_union_type_first_element(&self, node: EsNode<'a>, c: &Context<'a>) -> bool {
        let tree = &self.tree;
        tree.is_union_type(Some(node))
            && tree.is_single_line_block_comment(c.comment)
            && !self.is_prettier_ignore_comment(c)
            && (c.comment.span.end..tree.loc_start(node)).all(|at| {
                tree.comment_around(at).is_some()
                    || tree.text.get(at as usize).is_some_and(|b| is_blank(*b))
            })
    }

    fn add_leading_comment_to_possible_union_type(
        &self,
        node: EsNode<'a>,
        c: &Context<'a>,
    ) -> Handled<'a> {
        match self.should_attach_to_union_type_first_element(node, c) {
            true => leading(self.tree.list(node, Field::Types).next()?),
            false => leading(node),
        }
    }

    fn handle_assignment_like_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, following) = (c.enclosing?, c.following?);
        let is_type_alias = tree.ty(enclosing) == Some(T::TSTypeAliasDeclaration);
        let is_assignment_like = is_type_alias
            || matches!(
                tree.ty(enclosing),
                Some(T::VariableDeclarator | T::AssignmentExpression)
            );
        let is_complex = matches!(
            tree.ty(following),
            Some(
                T::ObjectExpression
                    | T::ArrayExpression
                    | T::TemplateLiteral
                    | T::TaggedTemplateExpression
                    | T::TSTypeLiteral
            )
        );
        if is_assignment_like
            && c.placement == Placement::EndOfLine
            && (is_complex || c.comment.is_block())
        {
            return self.add_leading_comment_to_possible_union_type(following, c);
        }
        if is_type_alias {
            let equals = tree.index_of(b"=", tree.loc_end(tree.child(enclosing, Field::Id)?));
            if i64::from(c.comment.span.start) >= equals {
                return self.add_leading_comment_to_possible_union_type(following, c);
            }
        }
        None
    }

    fn handle_tagged_template_expression_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c
            .enclosing
            .filter(|it| tree.ty(*it) == Some(T::TaggedTemplateExpression))?;
        leading(
            c.following
                .filter(|it| tree.child(enclosing, Field::Quasi) == Some(*it))?,
        )
    }

    fn handle_ts_function_trailing_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c.enclosing.filter(|_| c.following.is_none())?;
        let is_after_head = matches!(
            tree.ty(enclosing),
            Some(T::TSMethodSignature | T::TSDeclareFunction | T::TSAbstractMethodDefinition)
        ) && (c.preceding.is_none()
            || c.preceding != tree.child(enclosing, Field::ReturnType))
            && tree.next_character(c.comment.span.end) == Some(b';');
        trailing(is_after_head.then_some(enclosing)?)
    }

    fn handle_ignore_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let enclosing = c
            .enclosing
            .filter(|it| self.tree.ty(*it) == Some(T::TSMappedType))?;
        if !self.is_prettier_ignore_comment(c)
            || c.following.is_none()
            || c.following != self.tree.child(enclosing, Field::Key)
        {
            return None;
        }
        self.ignore_instead_of_owner(enclosing);
        Some((enclosing, Position::Dangling, Marker::InIgnoredNode))
    }

    fn handle_ts_mapped_type_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c
            .enclosing
            .filter(|it| tree.ty(*it) == Some(T::TSMappedType))?;
        let bracket = tree.index_of(b"[", tree.loc_start(enclosing));
        dangling((i64::from(c.comment.span.end) < bracket).then_some(enclosing)?)
    }

    fn handle_switch_default_case_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, following) = (c.enclosing?, c.following?);
        if tree.ty(enclosing) != Some(T::SwitchCase)
            || tree.child(enclosing, Field::Test).is_some()
            || tree.list(enclosing, Field::Consequent).next() != Some(following)
        {
            return None;
        }
        match tree.ty(following) == Some(T::BlockStatement) && c.comment.is_line() {
            true => tree.add_block_statement_first_comment(following),
            false => dangling(enclosing),
        }
    }

    fn handle_last_union_element_in_expression(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let preceding = c.preceding.filter(|it| tree.is_union_type(Some(*it)))?;
        match tree.ty(c.enclosing?) {
            Some(T::TSArrayType) if c.following.is_none() => {}
            Some(T::TSIntersectionType | T::TSUnionType) => {}
            _ => return None,
        }
        trailing(tree.list(preceding, Field::Types).last()?)
    }

    fn handle_comments_in_destructuring_pattern(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, following) = (c.enclosing?, c.following?);
        let closer = match tree.ty(enclosing) {
            Some(T::ObjectPattern) => b'}',
            Some(T::ArrayPattern) => b']',
            _ => return None,
        };
        if tree.child(enclosing, Field::TypeAnnotation) != Some(following)
            || tree.ty(following) != Some(T::TSTypeAnnotation)
        {
            return None;
        }
        if tree.next_character(c.comment.span.end) != Some(closer) {
            return leading(following);
        }
        match c.preceding {
            Some(preceding) => trailing(preceding),
            None => dangling(enclosing),
        }
    }

    fn handle_last_binary_operator_operand(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, preceding) = (c.enclosing?, c.preceding?);
        if c.following.is_some()
            || tree.ty(enclosing) != Some(T::UnaryExpression)
            || !matches!(
                tree.ty(preceding),
                Some(T::LogicalExpression | T::BinaryExpression)
            )
        {
            return None;
        }
        let right = tree.child(preceding, Field::Right)?;
        let right_start = tree.loc_start(right);
        let argument_start = tree.loc_start(tree.child(enclosing, Field::Argument)?);
        let is_on_line_of_right = tree.has_newline_in_range(argument_start, right_start)
            && tree.is_single_line_comment(c.comment)
            && !tree.has_newline_in_range(right_start, c.comment.span.start);
        trailing(is_on_line_of_right.then_some(right)?)
    }

    fn handle_property_signature_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, following) = (c.enclosing?, c.following?);
        let key = match tree.ty(enclosing) {
            Some(T::TSPropertySignature) => tree.child(enclosing, Field::Key),
            Some(T::TSMappedType) => (tree.child(enclosing, Field::NameType))
                .or_else(|| tree.child(enclosing, Field::Constraint)),
            _ => return None,
        };
        if c.placement == Placement::EndOfLine
            && matches!(
                tree.ty(following),
                Some(T::TSUnionType | T::TSIntersectionType)
            )
        {
            return leading(following);
        }
        if tree.child(enclosing, Field::TypeAnnotation).is_some() && c.comment.is_block() {
            let colon = tree.index_of(b":", tree.loc_end(key?));
            if colon < i64::from(c.comment.span.start) {
                return self.add_leading_comment_to_possible_union_type(following, c);
            }
        }
        None
    }

    fn handle_binary_cast_expression_comment(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c
            .enclosing
            .filter(|it| tree.is_binary_cast_expression(*it))?;
        if c.preceding.is_none()
            || c.preceding != tree.child(enclosing, Field::Expression)
            || tree.is_single_line_comment(c.comment)
        {
            return None;
        }
        match c.following {
            Some(following) => leading(following),
            None => trailing(enclosing),
        }
    }

    fn handle_arrow_expression_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c
            .enclosing
            .filter(|it| tree.ty(*it) == Some(T::ArrowFunctionExpression))?;
        let following = c.following.filter(|_| c.preceding.is_some())?;
        let body_start = tree.loc_start(tree.child(enclosing, Field::Body)?);
        let is_before_arrow = i64::from(c.comment.span.end) < tree.last_index_of(b"=>", body_start);
        match is_before_arrow {
            true => None,
            false => tree.add_block_or_not_comment(following),
        }
    }

    /// The parent that a comment in `node` would have as the next of its `ancestors`.
    fn ancestor_of(&self, node: EsNode<'a>) -> Option<EsNode<'a>> {
        let mut parent = self.tree.parent(node)?;
        while !self.tree.can_attach_comment(parent) {
            parent = self.tree.parent(parent)?;
        }
        Some(parent)
    }

    fn enclosing_assignment_chain_expression_statement(
        &self,
        node: EsNode<'a>,
    ) -> Option<EsNode<'a>> {
        let tree = &self.tree;
        let mut child = node;
        loop {
            let ancestor = self.ancestor_of(child)?;
            let is_in =
                |field: Field| tree.child(ancestor, field).map(|it| it.node) == Some(child.node);
            match tree.ty(ancestor) {
                Some(T::AssignmentExpression) if is_in(Field::Right) => child = ancestor,
                Some(T::ArrowFunctionExpression) if is_in(Field::Body) => child = ancestor,
                Some(T::ExpressionStatement) if is_in(Field::Expression) => return Some(ancestor),
                _ => return None,
            }
        }
    }

    fn handle_sequence_expression_leading_comment(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c
            .enclosing
            .filter(|it| tree.ty(*it) == Some(T::SequenceExpression))?;
        let is_before_first = c.preceding.is_none()
            && c.following.is_some()
            && c.following == tree.list(enclosing, Field::Expressions).next();
        leading(is_before_first.then_some(enclosing)?)
    }

    fn handle_parenthesized_expression_trailing_comment(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        if c.following.is_some() {
            return None;
        }
        let (enclosing, preceding) = (c.enclosing?, c.preceding?);
        let enclosing_type = tree.ty(enclosing);
        let is_in = |field: Field| tree.child(enclosing, field) == Some(preceding);
        if enclosing_type == Some(T::ExpressionStatement) && is_in(Field::Expression) {
            return trailing(enclosing);
        }
        let is_assignment = tree.ty(preceding) == Some(T::AssignmentExpression);
        let is_arrow = tree.ty(preceding) == Some(T::ArrowFunctionExpression);
        if ((is_assignment
            && enclosing_type == Some(T::AssignmentExpression)
            && is_in(Field::Right))
            || (is_arrow
                && enclosing_type == Some(T::ArrowFunctionExpression)
                && is_in(Field::Body)))
            && let Some(statement) = self.enclosing_assignment_chain_expression_statement(enclosing)
        {
            return trailing(statement);
        }
        let is_sequence = tree.ty(preceding) == Some(T::SequenceExpression);
        let is_whole_right_side = match enclosing_type {
            Some(T::ArrowFunctionExpression) => is_in(Field::Body),
            Some(T::VariableDeclarator) => is_in(Field::Init),
            Some(T::ReturnStatement) => is_in(Field::Argument),
            Some(T::AssignmentExpression) => is_in(Field::Right),
            _ => false,
        };
        if !is_whole_right_side {
            return None;
        }
        if is_sequence {
            return trailing(tree.list(preceding, Field::Expressions).last()?);
        }
        trailing(
            tree.child(preceding, Field::Right)
                .filter(|_| is_assignment)?,
        )
    }

    fn handle_union_type_leading_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let following = c.following?;
        (self.should_attach_to_union_type_first_element(following, c)).then_some(())?;
        leading(self.tree.list(following, Field::Types).next()?)
    }

    // ── attach/*.js ──

    fn handle_for_x_statement_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, following) = (c.enclosing?, c.following?);
        if !matches!(
            tree.ty(enclosing),
            Some(T::ForInStatement | T::ForOfStatement | T::ForStatement)
        ) || tree.child(enclosing, Field::Body) != Some(following)
        {
            return None;
        }
        let closing = tree.last_index_of(b")", tree.loc_start(following));
        leading((i64::from(c.comment.span.start) > closing).then_some(following)?)
    }

    fn handle_if_statement_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c
            .enclosing
            .filter(|it| tree.ty(*it) == Some(T::IfStatement))?;
        let following = c.following?;
        if tree.next_character(c.comment.span.end) == Some(b')') {
            return trailing(c.preceding?);
        }
        let consequent = tree.child(enclosing, Field::Consequent);
        if Some(following) == consequent {
            return leading(following);
        }
        let preceding = c.preceding.filter(|it| Some(*it) == consequent)?;
        if Some(following) != tree.child(enclosing, Field::Alternate) {
            return None;
        }
        // `handleCommentsBetween`
        let else_token = tree.index_of(b"else", tree.loc_end(preceding));
        if i64::from(c.comment.span.start) >= else_token {
            return leading(following);
        }
        if tree.ty(preceding) != Some(T::BlockStatement)
            && tree.is_single_line_comment(c.comment)
            && !tree.has_newline_in_range(tree.loc_end(preceding), c.comment.span.start)
        {
            return trailing(preceding);
        }
        dangling(enclosing)
    }

    fn handle_switch_statement_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing = c
            .enclosing
            .filter(|it| tree.ty(*it) == Some(T::SwitchStatement))?;
        let is_in_empty_braces = tree.list(enclosing, Field::Cases).next().is_none()
            && c.following.is_none()
            && c.preceding.is_some()
            && c.preceding == tree.child(enclosing, Field::Discriminant)
            && tree.next_character(c.comment.span.end) == Some(b'}');
        dangling(is_in_empty_braces.then_some(enclosing)?)
    }

    fn handle_while_like_comments(&mut self, c: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing, following) = (c.enclosing?, c.following?);
        if !matches!(
            tree.ty(enclosing),
            Some(T::WhileStatement | T::WithStatement)
        ) {
            return None;
        }
        if tree.next_character(c.comment.span.end) == Some(b')') {
            return trailing(c.preceding?);
        }
        leading(Some(following).filter(|it| tree.child(enclosing, Field::Body) == Some(*it))?)
    }
}

// ───────────────────────────── for the tests ─────────────────────────────

/// A line for each comment: where it is, and what it is attached to. And one for each node that is ignored without owning
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
        cast_parentheses: Vec::new(),
        may_have_decorators: true,
    };
    let describe = |owner: Owner| {
        let node = owner.node.in_file(file);
        let node = EsNode {
            node,
            ty: node.node_type(),
            cast: owner.cast,
        };
        let name = tree.ty(node).map_or("ParenthesizedExpression", T::name);
        (name, tree.loc(node))
    };
    let mut lines: Vec<(u32, Vec<u8>)> = Vec::new();
    for (comment, attachment) in comments.iter().zip(&attached.attachments) {
        if attachment.marker == Marker::InIgnoredNode {
            continue;
        }
        let (name, span) = describe(attachment.owner);
        let position = match attachment.position {
            Position::Leading => "L",
            Position::Trailing => "T",
            Position::Dangling => "D",
        };
        let marker = match attachment.marker {
            Marker::None | Marker::InIgnoredNode => "-",
            Marker::CommentBeforeArrow => "commentBeforeArrow",
            Marker::Implements => "implements",
            Marker::Extends => "extends",
        };
        let mut line = Vec::new();
        let _ = write!(
            line,
            "C {} {} {position} {name} {} {} {marker}{}",
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
        lines.push((comment.span.start, line));
    }
    for owner in &attached.ignored {
        let (name, span) = describe(*owner);
        let mut line = Vec::new();
        let _ = write!(line, "I {name} {} {}", span.start, span.end);
        lines.push((span.start, line));
    }
    crate::sort::sort_by_key(&mut lines, |it| it.0);
    for (_, line) in lines {
        out.extend_from_slice(&line);
        out.push(b'\n');
    }
}
