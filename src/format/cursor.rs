//! `cursorOffset`: where the cursor is in the formatted text.
//!
//! What Prettier does (`main/get-cursor-node.js`, `main/core.js`):
//! 1. Before formatting, it finds the smallest part of the text that the cursor is in: a node
//!    without children, or what is between two nodes. [`locate`].
//! 2. While formatting, it notes where that part ends up in the output.
//! 3. It compares the part before and after, character by character, with the cursor as one more
//!    character of the text before. Where the cursor is deleted is where it is now. [`resolve`].
//!
//! Which nodes there are matters for 1. Prettier sees Babel's tree for JavaScript and
//! typescript-estree's for TypeScript. [`Walk`] says what their nodes are in terms of the handles:
//! only where they start and end, what is in them, and in which order Prettier visits that.

use crate::js::print::binary_like_expression::should_flatten;
use crate::js::utils::typescript::without_lone_operator;
use crate::ir::element::{CursorMark, FormatElement};
use crate::ir::formatter::Formatter;
use crate::prelude::{Format, if_group_breaks};
use crate::{FormatError, FormatOptions, Scratch};
use bun_lint::ast::{
    BinOp, Class, EntityName, Enum, EnumMember, ExportSpec, Expr, ExprKind, File, FnBody, Func, Ident, ImportEqualsTarget,
    ImportSpec, Interface, Jsx, JsxChild, Key, KeyKind, List, Member, MemberKind, Modifier, Module, Param, Pat,
    PatElem, PatKind, PatProp, Prop, PropKind, Stmt, StmtKind, TupleElem, TypeKind, TypeNode, TypeParam, VarDecl,
};
use bun_lint::span::Span;
use bun_core::strings;
use bun_lint::tokens::{skip_trivia, skip_trivia_back};
use smallvec::SmallVec;

/// The part of the text that the cursor is in.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Region {
    /// A node without children.
    Node(Span),
    /// What is between two nodes. `None`: the start or the end of the text.
    Between { before: Option<Span>, after: Option<Span> },
}

// ───────────────────────────── the tree that Prettier sees ─────────────────────────────

/// A node of ESTree: Prettier's `locStart` and `locEnd` of it, and what tells its children.
#[derive(Copy, Clone)]
struct Item<'a> {
    span: Span,
    kind: Kind<'a>,
}

#[derive(Copy, Clone)]
enum Kind<'a> {
    Leaf,
    /// A leaf that Prettier does not print, so that it does not learn where it ends up: the second
    /// name of `import { a }`.
    UnmarkedLeaf,
    /// Text in the JSX element that starts there.
    JsxText(u32),
    /// The name of a property or a member, which is a leaf.
    Name,
    /// Its only child is a leaf.
    LeafIn(Span),
    /// Its children are two leaves.
    Leaves(Span, Span),
    Program,
    Expr(Expr<'a>),
    /// Without the `ChainExpression` around it.
    ChainElement(Expr<'a>),
    /// A `ParenthesizedExpression`: of those around the expression, the one that is in so many.
    Parenthesized(Expr<'a>, usize),
    /// The `LogicalExpression` of the left side and so many of the operands in the right side.
    Logical(Expr<'a>, usize),
    /// The left side of a binary expression that is written as one list of operands with it.
    /// Prettier does not print it as a node of its own, so that it does not learn where it ends up.
    FlattenedOperand(Expr<'a>),
    /// `x!!`: the `TSNonNullExpression` that has so many others in it.
    NonNull(Expr<'a>, usize),
    /// With its `export`.
    Stmt(Stmt<'a>),
    /// Without its `export`.
    Declaration(Stmt<'a>),
    Statements(List<'a, Stmt<'a>>),
    CatchClause(Stmt<'a>),
    Case(bun_lint::ast::Case<'a>),
    VarDecl(VarDecl<'a>),
    /// `has_name`: not for a method, whose name is the key.
    Func(Func<'a>, bool),
    ClassBody(Class<'a>),
    Member(Member<'a>),
    Prop(Prop<'a>),
    ImportAttribute(Prop<'a>),
    Decorator(Expr<'a>),
    /// `TSParameterProperty`
    ParameterProperty(Param<'a>),
    /// `AssignmentPattern` or `RestElement` of a parameter.
    ParameterPattern(Param<'a>),
    /// A pattern with the type that is part of it in ESTree, and the parameter whose decorators are.
    Binding(Pat<'a>, Option<TypeNode<'a>>, Option<Param<'a>>),
    /// `AssignmentPattern`
    PatternWithDefault(Pat<'a>, Expr<'a>),
    /// `RestElement`
    RestPattern(Pat<'a>),
    PatProp(PatProp<'a>),
    Type(TypeNode<'a>),
    TypeAnnotation(TypeNode<'a>),
    TypeParams(List<'a, TypeParam<'a>>),
    TypeArgs(List<'a, TypeNode<'a>>),
    TypeParam(TypeParam<'a>),
    /// `TSImportType`, without the `typeof` before it.
    ImportType(TypeNode<'a>),
    TupleElem(TupleElem<'a>),
    /// `TSNamedTupleMember`, without the `...` before it.
    NamedTupleMember(TupleElem<'a>),
    /// The first so many names of `A.B.C`.
    EntityName(EntityName<'a>, usize),
    /// The first so many names of `namespace A.B.C`.
    ModuleName(Module<'a>, usize),
    InterfaceBody(Interface<'a>),
    EnumBody(Enum<'a>),
    EnumMember(EnumMember<'a>),
    JsxOpening(Jsx<'a>),
    JsxClosing(Jsx<'a>),
    JsxContainer(Expr<'a>),
}

const fn leaf<'a>(span: Span) -> Item<'a> {
    Item { span, kind: Kind::Leaf }
}

const fn unmarked_leaf<'a>(span: Span) -> Item<'a> {
    Item {
        span,
        kind: Kind::UnmarkedLeaf,
    }
}

struct Walk<'a> {
    file: &'a File<'a>,
    /// Babel's tree. Otherwise typescript-estree's.
    is_babel: bool,
}

impl<'a> Walk<'a> {
    fn text(&self) -> &'a [u8] {
        self.file.text()
    }

    /// Prettier's `__contentEnd`: `end`, or if a `;` is before it, where what is before that ends.
    fn content_end(&self, end: u32) -> u32 {
        match end.checked_sub(1).and_then(|at| self.text().get(at as usize)) {
            Some(b';') => skip_trivia_back(self.text(), end - 1),
            _ => end,
        }
    }

    /// Prettier's `locEnd` of a statement. `is_export`: of the `export` around it.
    fn statement_end(&self, mut statement: Stmt<'a>, is_export: bool) -> u32 {
        if is_export {
            return self.content_end(statement.span().end);
        }
        loop {
            let span = statement.span();
            statement = match statement.kind() {
                StmtKind::If { yes, no, .. } => no.unwrap_or(yes),
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::With { body, .. }
                | StmtKind::Labeled { body, .. } => body,
                StmtKind::Expr(_)
                | StmtKind::Import(_)
                | StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::ExportDefault(_)
                | StmtKind::Return(_)
                | StmtKind::Throw(_)
                | StmtKind::DoWhile { .. }
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Debugger => return self.content_end(span.end),
                StmtKind::Var(declarations) => return declarations.last().map_or(span.end, |last| last.span().end),
                _ => return span.end,
            };
        }
    }

    fn statement(&self, statement: Stmt<'a>) -> Item<'a> {
        let is_export = statement.is_exported();
        Item {
            span: Span::new(statement.span().start, self.statement_end(statement, is_export)),
            kind: Kind::Stmt(statement),
        }
    }

    /// What is in the head of a `for`: a declaration, or an expression.
    fn head(&self, statement: Stmt<'a>) -> Item<'a> {
        match statement.kind() {
            StmtKind::Expr(e) => self.expr(e),
            _ => self.statement(statement),
        }
    }

    fn expr(&self, e: Expr<'a>) -> Item<'a> {
        match self.kept_parentheses(e).first() {
            Some(&span) => Item {
                span,
                kind: Kind::Parenthesized(e, 1),
            },
            None => Item {
                span: e.span(),
                kind: Kind::Expr(e),
            },
        }
    }

    /// The parentheses around `e` that are a `ParenthesizedExpression` for Prettier, the outermost
    /// first: those of Babel's tree that a type cast comment is before.
    fn kept_parentheses(&self, e: Expr<'a>) -> SmallVec<[Span; 2]> {
        let mut kept = SmallVec::new();
        if !self.is_babel || !e.is_parenthesized() {
            return kept;
        }
        let (text, outer, mut inner) = (self.text(), e.outer_span(), e.span());
        while inner.start > outer.start {
            let open = skip_trivia_back(text, inner.start).saturating_sub(1);
            let close = skip_trivia(text, inner.end);
            if text.get(open as usize) != Some(&b'(') || text.get(close as usize) != Some(&b')') {
                break;
            }
            inner = Span::new(open, close + 1);
            if self.is_after_type_cast_comment(open) {
                kept.push(inner);
            }
        }
        kept.reverse();
        kept
    }

    /// Whether there is a comment before `at`, with nothing but blanks between them, for which
    /// Prettier's `isTypeCastComment` holds.
    fn is_after_type_cast_comment(&self, at: u32) -> bool {
        let text = self.text();
        let trivia = text.get(skip_trivia_back(text, at) as usize..at as usize).unwrap_or_default();
        let mut rest = trivia;
        let mut last_comment = None;
        while let Some((_, tail)) = rest.split_first() {
            (last_comment, rest) = match rest {
                [b'/', b'*', after @ ..] => match strings::index_of(after, b"*/") {
                    Some(end) => (after.get(..end), after.get(end + 2..).unwrap_or_default()),
                    None => (None, &[][..]),
                },
                [b'/', b'/', after @ ..] => (None, after.get(strings::index_of_any(after, b"\r\n").unwrap_or(after.len())..).unwrap_or_default()),
                _ => (last_comment, tail),
            };
        }
        let Some(content) = last_comment.filter(|content| content.starts_with(b"*")) else {
            return false;
        };
        [&b"@type"[..], b"@satisfies"].iter().any(|tag| {
            let mut rest = content;
            while let Some(found) = strings::index_of(rest, tag) {
                rest = rest.get(found + tag.len()..).unwrap_or_default();
                if !rest.first().is_some_and(|&byte| byte.is_ascii_alphanumeric() || byte == b'_') {
                    return true;
                }
            }
            false
        })
    }

    /// `a && (b && c)` is `(a && b) && c` for Prettier (`rebalanceLogicalTree`). The operands that are
    /// in the right side of `e`, if that has the operator of `e`.
    fn operands_in_right_side(e: Expr<'a>) -> SmallVec<[Expr<'a>; 4]> {
        let mut operands = SmallVec::new();
        let ExprKind::Binary { op, right, .. } = e.kind() else {
            return operands;
        };
        let is_same = |it: Expr<'a>| matches!(it.kind(), ExprKind::Binary { op: other, .. } if other == op);
        if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) || !is_same(right) {
            return operands;
        }
        let mut stack: SmallVec<[Expr<'a>; 8]> = SmallVec::new();
        stack.push(right);
        while let Some(at) = stack.pop() {
            match at.kind() {
                ExprKind::Binary { op: other, left, right } if other == op => stack.extend([right, left]),
                _ => operands.push(at),
            }
        }
        operands
    }

    /// What is in the `LogicalExpression` of the left side of `e` and the first `count` of
    /// `operands`.
    fn logical_parts(&self, e: Expr<'a>, operands: &[Expr<'a>], count: usize, out: &mut Vec<Item<'a>>) {
        let (ExprKind::Binary { op, left, .. }, Some(&last)) = (e.kind(), operands.get(count.wrapping_sub(1))) else {
            return;
        };
        out.push(match operands.get(count.wrapping_sub(2)) {
            Some(before_last) => Item {
                span: Span::new(left.span().start, before_last.span().end),
                kind: Kind::Logical(e, count - 1),
            },
            None => self.left_operand(op, left),
        });
        out.push(self.expr(last));
    }

    /// `left`, which is the left side of a binary expression with the operator `op`.
    fn left_operand(&self, op: BinOp, left: Expr<'a>) -> Item<'a> {
        let item = self.expr(left);
        match (item.kind, left.kind()) {
            (Kind::Expr(_), ExprKind::Binary { op: left_op, .. }) if left_op != BinOp::Comma && should_flatten(op, left_op) => {
                Item {
                    span: item.span,
                    kind: Kind::FlattenedOperand(left),
                }
            }
            _ => item,
        }
    }

    fn ty(&self, ty: TypeNode<'a>) -> Item<'a> {
        let ty = without_lone_operator(ty);
        Item {
            span: ty.span(),
            kind: Kind::Type(ty),
        }
    }

    fn type_annotation(&self, ty: TypeNode<'a>) -> Item<'a> {
        Item {
            span: ty.annotation_span(),
            kind: Kind::TypeAnnotation(ty),
        }
    }

    fn type_params(&self, params: List<'a, TypeParam<'a>>) -> Option<Item<'a>> {
        params.angle_brackets_span().map(|span| Item {
            span,
            kind: Kind::TypeParams(params),
        })
    }

    fn type_args(&self, args: List<'a, TypeNode<'a>>) -> Option<Item<'a>> {
        args.angle_brackets_span().map(|span| Item {
            span,
            kind: Kind::TypeArgs(args),
        })
    }

    fn entity_name(&self, name: EntityName<'a>, count: usize) -> Option<Item<'a>> {
        let (first, last) = (name.first()?, name.get(count.checked_sub(1)?)?);
        Some(match count {
            1 => leaf(first.span()),
            _ => Item {
                span: Span::new(first.span().start, last.span().end),
                kind: Kind::EntityName(name, count),
            },
        })
    }

    /// The module that the name at `index` of `namespace A.B.C` is the name of.
    fn nested_module(module: Module<'a>, index: usize) -> Option<Module<'a>> {
        let mut at = module;
        for _ in 0..index {
            at = at.nested()?;
        }
        Some(at)
    }

    fn module_name(&self, module: Module<'a>, count: usize) -> Option<Item<'a>> {
        let last = Self::nested_module(module, count.checked_sub(1)?)?;
        Some(match count {
            1 => leaf(module.name_span()),
            _ => Item {
                span: Span::new(module.name_span().start, last.name_span().end),
                kind: Kind::ModuleName(module, count),
            },
        })
    }

    /// The name of a property or a member.
    fn key(&self, key: Key<'a>) -> Item<'a> {
        let span = key.inner_span(self.file);
        match key.kind() {
            KeyKind::Computed(e) => self.expr(e),
            KeyKind::Private(_) => self.private_name(span),
            _ if key.is_jsx() => self.jsx_name(span),
            _ => Item {
                span,
                kind: Kind::Name,
            },
        }
    }

    /// Babel has an `Identifier` in a `PrivateName`.
    fn private_name(&self, span: Span) -> Item<'a> {
        match self.is_babel {
            true => Item {
                span,
                kind: Kind::LeafIn(Span::new(span.start + 1, span.end)),
            },
            false => leaf(span),
        }
    }

    /// `a`, `a-b`, or `a:b`, which is a `JSXNamespacedName`.
    fn jsx_name(&self, span: Span) -> Item<'a> {
        match self.file.jsx_namespace_and_name(span.start) {
            Some((namespace, name)) => Item {
                span,
                kind: Kind::Leaves(namespace, name),
            },
            None => leaf(span),
        }
    }

    fn decorators(&self, modifiers: List<'a, Modifier<'a>>, out: &mut Vec<Item<'a>>) {
        for modifier in modifiers {
            if let Some(expression) = modifier.decorator() {
                out.push(Item {
                    span: modifier.span(),
                    kind: Kind::Decorator(expression),
                });
            }
        }
    }

    /// Prettier's `locStart`: a node starts with its first decorator.
    fn with_decorators(span: Span, modifiers: List<'a, Modifier<'a>>) -> Span {
        let first = modifiers.iter().find(|it| it.decorator().is_some());
        Span::new(first.map_or(span.start, |it| it.span().start.min(span.start)), span.end)
    }

    fn binding(&self, pat: Pat<'a>, ty: Option<TypeNode<'a>>, span: Span) -> Item<'a> {
        Item {
            span,
            kind: Kind::Binding(pat, ty, None),
        }
    }

    fn pattern(&self, pat: Pat<'a>) -> Item<'a> {
        self.binding(pat, None, pat.span())
    }

    fn param(&self, param: Param<'a>) -> Item<'a> {
        let has_keyword = param.modifiers().iter().any(|it| it.decorator().is_none());
        match has_keyword {
            true => Item {
                span: Self::with_decorators(param.span(), param.modifiers()),
                kind: Kind::ParameterProperty(param),
            },
            false => {
                let inner = self.param_without_modifiers(param);
                Item {
                    span: Self::with_decorators(inner.span, param.modifiers()),
                    kind: match inner.kind {
                        Kind::Binding(pat, ty, _) => Kind::Binding(pat, ty, Some(param)),
                        kind => kind,
                    },
                }
            }
        }
    }

    fn param_without_modifiers(&self, param: Param<'a>) -> Item<'a> {
        match param.is_rest() || param.default().is_some() {
            true => Item {
                span: param.span_without_modifiers(),
                kind: Kind::ParameterPattern(param),
            },
            false => self.binding(param.pat(), param.ty(), param.binding_span()),
        }
    }

    fn function_parts(&self, func: Func<'a>, has_name: bool, out: &mut Vec<Item<'a>>) {
        if has_name {
            out.extend(func.name().map(|name| leaf(name.span())));
        }
        out.extend(self.type_params(func.type_params()));
        out.extend(func.params_with_this().map(|param| self.param(param)));
        out.extend(func.return_type().map(|ty| self.type_annotation(ty)));
        match func.body() {
            FnBody::None => {}
            FnBody::Expr(e) => out.push(self.expr(e)),
            FnBody::Block(statements) => out.extend(func.body_span().map(|span| Item {
                span,
                kind: Kind::Statements(statements),
            })),
        }
    }

    /// The function of a method. In Babel's tree its parts are in the method itself.
    fn method_value(&self, func: Func<'a>, out: &mut Vec<Item<'a>>) {
        match self.is_babel {
            true => self.function_parts(func, false, out),
            false => out.push(Item {
                span: func.span_from_params(),
                kind: Kind::Func(func, false),
            }),
        }
    }

    fn class_parts(&self, class: Class<'a>, out: &mut Vec<Item<'a>>) {
        self.decorators(class.modifiers(), out);
        out.extend(class.name().map(|name| leaf(name.span())));
        out.extend(self.type_params(class.type_params()));
        out.extend(class.extends().map(|e| self.expr(e)));
        out.extend(self.type_args(class.extends_args()));
        out.extend(class.implements().iter().map(|ty| self.ty(ty)));
        out.push(Item {
            span: class.body_span(),
            kind: Kind::ClassBody(class),
        });
    }

    fn member(&self, member: Member<'a>) -> Item<'a> {
        Item {
            span: Self::with_decorators(member.span(), member.modifiers()),
            kind: Kind::Member(member),
        }
    }

    fn member_parts(&self, member: Member<'a>, out: &mut Vec<Item<'a>>) {
        self.decorators(member.modifiers(), out);
        let key = member.key().map(|key| self.key(key)).or_else(|| member.constructor_keyword().map(|it| leaf(it.span())));
        match (member.kind(), member.func()) {
            (MemberKind::StaticBlock, Some(func)) => {
                if let FnBody::Block(statements) = func.body() {
                    out.extend(statements.iter().map(|it| self.statement(it)));
                }
            }
            (MemberKind::IndexSignature | MemberKind::CallSignature | MemberKind::ConstructSignature, Some(func)) => {
                self.function_parts(func, false, out);
            }
            (_, Some(func)) if member.is_signature() => {
                out.extend(key);
                self.function_parts(func, false, out);
            }
            (_, Some(func)) => {
                out.extend(key);
                self.method_value(func, out);
            }
            (_, None) => {
                out.extend(key);
                out.extend(member.ty().map(|ty| self.type_annotation(ty)));
                out.extend(member.init().map(|e| self.expr(e)));
            }
        }
    }

    fn prop_parts(&self, prop: Prop<'a>, out: &mut Vec<Item<'a>>) {
        if prop.is_jsx_attribute() {
            out.extend(prop.key().map(|key| self.key(key)));
            out.extend(prop.value().map(|value| self.jsx_child(value)));
            return;
        }
        match (prop.kind(), prop.func()) {
            (PropKind::Spread, _) => out.extend(prop.value().map(|e| self.expr(e))),
            (PropKind::Method | PropKind::Getter | PropKind::Setter, Some(func)) => {
                out.extend(prop.key().map(|key| self.key(key)));
                self.method_value(func, out);
            }
            _ => {
                out.extend(prop.key().map(|key| self.key(key)));
                out.extend(prop.value().map(|e| self.expr(e)));
            }
        }
    }

    /// A child of a JSX element, or the value of an attribute: in braces it is in a
    /// `JSXExpressionContainer`.
    fn jsx_child(&self, e: Expr<'a>) -> Item<'a> {
        match (e.jsx_container_span(), e.kind()) {
            (Some(span), ExprKind::Spread(_)) => Item {
                span,
                kind: Kind::Expr(e),
            },
            // `{}` has a `JSXEmptyExpression` in it.
            (Some(span), ExprKind::Missing) => Item {
                span,
                kind: Kind::LeafIn(span.shrink(1, 1)),
            },
            (Some(span), _) => Item {
                span,
                kind: Kind::JsxContainer(e),
            },
            (None, _) => self.expr(e),
        }
    }

    fn import_spec(spec: ImportSpec<'a>) -> Item<'a> {
        Item {
            span: spec.span(),
            kind: Kind::Leaves(spec.imported().span(), spec.local().span()),
        }
    }

    fn export_spec(spec: ExportSpec<'a>) -> Item<'a> {
        Item {
            span: spec.span(),
            kind: Kind::Leaves(spec.local().span(), spec.exported().span()),
        }
    }

    fn import_attributes(&self, statement: Stmt<'a>, out: &mut Vec<Item<'a>>) {
        let entries = statement.import_attributes().into_iter().flat_map(|it| it.entries());
        out.extend(entries.map(|it| Item {
            span: it.span(),
            kind: Kind::ImportAttribute(it),
        }));
    }

    fn label(statement: Stmt<'a>) -> Option<Item<'a>> {
        statement.label().map(|label: Ident<'a>| leaf(label.span()))
    }

    /// The text of a template between its delimiters. `span`: with them.
    fn template_element(span: Span, is_last: bool) -> Item<'a> {
        leaf(span.shrink(1, if is_last { 1 } else { 2 }))
    }

    fn expression_parts(&self, e: Expr<'a>, out: &mut Vec<Item<'a>>) {
        match e.kind() {
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_) => {}
            ExprKind::PrivateIdentifier(_) => {
                if let Kind::LeafIn(span) = self.private_name(e.span()).kind {
                    out.push(leaf(span));
                }
            }
            ExprKind::ImportMeta | ExprKind::NewTarget => {
                if let Some((meta, property)) = e.meta_property_spans() {
                    out.extend([leaf(meta), leaf(property)]);
                }
            }
            ExprKind::Template(template) => {
                let count = template.quasi_count();
                out.extend((0..count).map(|i| Self::template_element(template.quasi_span(i), i + 1 == count)));
                out.extend(template.exprs().iter().map(|it| self.expr(it)));
            }
            ExprKind::TaggedTemplate(call) => {
                out.push(self.expr(call.callee()));
                out.extend(self.type_args(call.type_args()));
                out.extend(call.template().map(|it| self.expr(it)));
            }
            ExprKind::Array(elements) => out.extend(elements.iter().filter(|it| !it.is_missing()).map(|it| self.expr(it))),
            ExprKind::Object(props) => out.extend(props.iter().map(|it| Item {
                span: it.span(),
                kind: Kind::Prop(it),
            })),
            ExprKind::Fn(func) => self.function_parts(func, true, out),
            ExprKind::Class(class) => self.class_parts(class, out),
            ExprKind::Dot { obj, name, .. } => {
                out.push(self.expr(obj));
                out.push(match name.bytes().starts_with(b"#") {
                    true => self.private_name(name.span()),
                    false => leaf(name.span()),
                });
            }
            ExprKind::Index { obj, index, .. } => out.extend([self.expr(obj), self.expr(index)]),
            ExprKind::Call(call) | ExprKind::New(call) => {
                out.push(self.expr(call.callee()));
                out.extend(self.type_args(call.type_args()));
                out.extend(call.args().iter().map(|it| self.expr(it)));
            }
            ExprKind::Unary { operand, .. } | ExprKind::Spread(operand) | ExprKind::Await(operand) => {
                out.push(self.expr(operand));
            }
            // `const` is a `TSTypeReference` with an `Identifier` in it.
            ExprKind::AsConst(operand) => {
                out.push(self.expr(operand));
                out.extend(e.const_keyword_span().map(|span| Item {
                    span,
                    kind: Kind::LeafIn(span),
                }));
            }
            ExprKind::NonNull(_) => self.non_null_parts(e, e.inner_non_null_spans().len(), out),
            ExprKind::Binary { .. } => {
                let in_right_side = Self::operands_in_right_side(e);
                if !in_right_side.is_empty() {
                    return self.logical_parts(e, &in_right_side, in_right_side.len(), out);
                }
                let operands = e.sequence();
                match (operands.len(), e.kind()) {
                    (1, ExprKind::Binary { op, left, right }) => out.extend([self.left_operand(op, left), self.expr(right)]),
                    _ => out.extend(operands.iter().map(|&it| self.expr(it))),
                }
            }
            ExprKind::Assign { target, value, .. } => out.extend([self.expr(target), self.expr(value)]),
            ExprKind::Cond { test, yes, no } => out.extend([self.expr(test), self.expr(yes), self.expr(no)]),
            ExprKind::Yield { value, .. } => out.extend(value.map(|it| self.expr(it))),
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => out.extend([self.expr(expr), self.ty(ty)]),
            ExprKind::Instantiation { expr, type_args } => {
                out.push(self.expr(expr));
                out.extend(self.type_args(type_args));
            }
            ExprKind::Jsx(jsx) => {
                out.push(match jsx.is_fragment() {
                    true => leaf(jsx.opening_span()),
                    false => Item {
                        span: jsx.opening_span(),
                        kind: Kind::JsxOpening(jsx),
                    },
                });
                out.extend(jsx.children_with_whitespace().map(|child| match child {
                    JsxChild::Expr(child) if child.is_jsx_text() => Item {
                        span: child.span(),
                        kind: Kind::JsxText(e.span().start),
                    },
                    JsxChild::Expr(child) => self.jsx_child(child),
                    JsxChild::Whitespace(span) => Item {
                        span,
                        kind: Kind::JsxText(e.span().start),
                    },
                }));
                out.extend(jsx.closing_span().map(|span| match jsx.is_fragment() {
                    true => leaf(span),
                    false => Item {
                        span,
                        kind: Kind::JsxClosing(jsx),
                    },
                }));
            }
            ExprKind::ImportCall { args } => out.extend(args.iter().filter(|it| !it.is_missing()).map(|it| self.expr(it))),
        }
    }

    /// What is in the `TSNonNullExpression` of `e` that has `inner` others in it.
    fn non_null_parts(&self, e: Expr<'a>, inner: usize, out: &mut Vec<Item<'a>>) {
        let ExprKind::NonNull(operand) = e.kind() else {
            return;
        };
        match inner.checked_sub(1).and_then(|at| e.inner_non_null_spans().nth(at)) {
            Some(span) => out.push(Item {
                span,
                kind: Kind::NonNull(e, inner - 1),
            }),
            None => out.push(self.expr(operand)),
        }
    }

    fn jsx_tag(&self, tag: Option<Expr<'a>>) -> Option<Item<'a>> {
        let tag = tag?;
        Some(match tag.kind() {
            ExprKind::Dot { .. } => self.expr(tag),
            _ => self.jsx_name(tag.span()),
        })
    }

    fn declaration_parts(&self, statement: Stmt<'a>, out: &mut Vec<Item<'a>>) {
        match statement.kind() {
            StmtKind::Empty | StmtKind::Debugger => {}
            StmtKind::Break(_) | StmtKind::Continue(_) => out.extend(Self::label(statement)),
            // Babel has a `DirectiveLiteral` in a `Directive`, which comes to the same.
            StmtKind::Expr(e) | StmtKind::Throw(e) | StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                out.push(self.expr(e));
            }
            StmtKind::Return(e) => out.extend(e.map(|it| self.expr(it))),
            StmtKind::Var(declarations) => out.extend(declarations.iter().map(|it| Item {
                span: it.span(),
                kind: Kind::VarDecl(it),
            })),
            StmtKind::Fn(func) => self.function_parts(func, true, out),
            StmtKind::Class(class) => self.class_parts(class, out),
            StmtKind::Interface(interface) => {
                out.push(leaf(interface.name().span()));
                out.extend(self.type_params(interface.type_params()));
                out.extend(interface.extends().iter().map(|ty| self.ty(ty)));
                out.push(Item {
                    span: interface.body_span(),
                    kind: Kind::InterfaceBody(interface),
                });
            }
            StmtKind::TypeAlias(alias) => {
                out.push(leaf(alias.name().span()));
                out.extend(self.type_params(alias.type_params()));
                out.push(self.ty(alias.ty()));
            }
            StmtKind::Enum(declaration) => {
                out.push(leaf(declaration.name().span()));
                out.push(Item {
                    span: declaration.body_span(),
                    kind: Kind::EnumBody(declaration),
                });
            }
            StmtKind::Module(module) => {
                let mut count = 1;
                let mut innermost = module;
                while let Some(nested) = innermost.nested() {
                    (count, innermost) = (count + 1, nested);
                }
                out.extend(self.module_name(module, count));
                out.extend(innermost.body_span().map(|span| Item {
                    span,
                    kind: Kind::Statements(innermost.body()),
                }));
            }
            StmtKind::If { test, yes, no } => {
                out.extend([self.expr(test), self.statement(yes)]);
                out.extend(no.map(|it| self.statement(it)));
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                out.extend(init.map(|it| self.head(it)));
                out.extend(test.map(|it| self.expr(it)));
                out.extend(update.map(|it| self.expr(it)));
                out.push(self.statement(body));
            }
            StmtKind::ForIn { left, expr, body } | StmtKind::ForOf { left, expr, body, .. } => {
                out.extend([self.head(left), self.expr(expr), self.statement(body)]);
            }
            // The order of Prettier's visitor keys.
            StmtKind::While { test, body } | StmtKind::DoWhile { body, test } => {
                out.extend([self.statement(body), self.expr(test)]);
            }
            StmtKind::Block(statements) => out.extend(statements.iter().map(|it| self.statement(it))),
            StmtKind::With { object, body } => out.extend([self.expr(object), self.statement(body)]),
            StmtKind::Switch { expr, cases } => {
                out.push(self.expr(expr));
                out.extend(cases.iter().map(|it| Item {
                    span: it.span(),
                    kind: Kind::Case(it),
                }));
            }
            StmtKind::Try { block, finalizer, .. } => {
                out.push(self.statement(block));
                out.extend(statement.catch_clause_span().map(|span| Item {
                    span,
                    kind: Kind::CatchClause(statement),
                }));
                out.extend(finalizer.map(|it| self.statement(it)));
            }
            StmtKind::Labeled { body, .. } => {
                out.extend(Self::label(statement));
                out.push(self.statement(body));
            }
            StmtKind::Import(import) => {
                out.extend(import.default().map(|local| Item {
                    span: local.span(),
                    kind: Kind::LeafIn(local.span()),
                }));
                if let (Some(span), Some(local)) = (import.namespace_span(), import.namespace()) {
                    out.push(Item {
                        span,
                        kind: Kind::LeafIn(local.span()),
                    });
                }
                out.extend(import.named().iter().map(Self::import_spec));
                out.extend(import.spec_span().map(leaf));
                self.import_attributes(statement, out);
            }
            StmtKind::ExportNamed(export) => {
                out.extend(export.items().iter().map(Self::export_spec));
                out.extend(export.spec_span().map(leaf));
                self.import_attributes(statement, out);
            }
            // In Babel's tree, `* as a` is an `ExportNamespaceSpecifier`.
            StmtKind::ExportStar { alias: Some(alias), .. } if self.is_babel => {
                let star = skip_trivia(self.text(), statement.span().start + "export".len() as u32);
                out.push(Item {
                    span: Span::new(star, alias.span().end),
                    kind: Kind::LeafIn(alias.span()),
                });
                out.extend(statement.module_specifier_span().map(leaf));
                self.import_attributes(statement, out);
            }
            StmtKind::ExportStar { alias, .. } => {
                out.extend(statement.module_specifier_span().map(leaf));
                self.import_attributes(statement, out);
                out.extend(alias.map(|it| leaf(it.span())));
            }
            StmtKind::ImportEquals(import) => {
                out.push(leaf(import.name().span()));
                match (import.target(), import.require_span(), statement.module_specifier_span()) {
                    (ImportEqualsTarget::Entity(name), ..) => out.extend(self.entity_name(name, name.len())),
                    (_, Some(span), Some(specifier)) => out.push(Item {
                        span,
                        kind: Kind::LeafIn(specifier),
                    }),
                    _ => {}
                }
            }
            StmtKind::ExportAsNamespace(_) => out.extend(statement.namespace_export_name().map(|it| leaf(it.span()))),
        }
    }

    fn type_parts(&self, ty: TypeNode<'a>, out: &mut Vec<Item<'a>>) {
        let span = ty.span();
        match ty.kind() {
            TypeKind::Error | TypeKind::Keyword(_) => {}
            // A `TSLiteralType` with the literal in it.
            TypeKind::StringLit(_) if ty.text().starts_with(b"`") => out.push(Item {
                span,
                kind: Kind::LeafIn(span.shrink(1, 1)),
            }),
            TypeKind::StringLit(_) | TypeKind::BoolLit(_) => out.push(leaf(span)),
            TypeKind::NumberLit(_) | TypeKind::BigIntLit { .. } => out.push(match ty.text().starts_with(b"-") {
                true => Item {
                    span,
                    kind: Kind::LeafIn(Span::new(skip_trivia(self.text(), span.start + 1), span.end)),
                },
                false => leaf(span),
            }),
            TypeKind::Heritage { expr, args } | TypeKind::Typeof { expr, args } => {
                out.push(self.expr(expr));
                out.extend(self.type_args(args));
            }
            TypeKind::Ref { name, args } => {
                out.extend(self.entity_name(name, name.len()));
                out.extend(self.type_args(args));
            }
            TypeKind::Import { is_typeof: true, .. } => out.extend(ty.import_span().map(|span| Item {
                span,
                kind: Kind::ImportType(ty),
            })),
            TypeKind::Import { .. } => self.import_type_parts(ty, out),
            TypeKind::Template(types) => {
                if let Some(template) = ty.as_template() {
                    let count = template.quasi_count();
                    out.extend((0..count).map(|i| Self::template_element(template.quasi_span(i), i + 1 == count)));
                }
                out.extend(types.iter().map(|it| self.ty(it)));
            }
            TypeKind::Union(types) | TypeKind::Intersection(types) => out.extend(types.iter().map(|it| self.ty(it))),
            TypeKind::Array(operand) | TypeKind::Keyof(operand) | TypeKind::Readonly(operand) => out.push(self.ty(operand)),
            TypeKind::UniqueSymbol => out.extend(ty.unique_symbol_keyword_span().map(leaf)),
            TypeKind::Tuple(elements) => out.extend(elements.iter().map(|it| self.tuple_element(it))),
            TypeKind::Fn(func) => self.function_parts(func, false, out),
            TypeKind::Object(members) => out.extend(members.iter().map(|it| self.member(it))),
            TypeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => out.extend([self.ty(check), self.ty(extends), self.ty(yes), self.ty(no)]),
            TypeKind::Infer(param) => out.push(Item {
                span: param.span(),
                kind: Kind::TypeParam(param),
            }),
            TypeKind::Mapped(mapped) => {
                out.push(leaf(mapped.param().name().span()));
                out.extend(mapped.param().constraint().map(|it| self.ty(it)));
                out.extend(mapped.name_type().map(|it| self.ty(it)));
                out.extend(mapped.ty().map(|it| self.ty(it)));
            }
            TypeKind::IndexedAccess { obj, index } => out.extend([self.ty(obj), self.ty(index)]),
            TypeKind::Predicate { ty: asserted, .. } => {
                out.extend(ty.predicate_param().map(|it| leaf(it.span())));
                // This `TSTypeAnnotation` has no `:`.
                out.extend(asserted.map(|it| Item {
                    span: it.outer_span(),
                    kind: Kind::TypeAnnotation(it),
                }));
            }
        }
    }

    fn import_type_parts(&self, ty: TypeNode<'a>, out: &mut Vec<Item<'a>>) {
        let TypeKind::Import { name, args, .. } = ty.kind() else {
            return;
        };
        out.extend(ty.import_source_span().map(leaf));
        out.extend(ty.import_attributes().map(|it| leaf(it.options_span())));
        out.extend(self.entity_name(name, name.len()));
        out.extend(self.type_args(args));
    }

    fn tuple_element(&self, element: TupleElem<'a>) -> Item<'a> {
        match element.name().is_some() || element.is_rest() || element.is_optional() {
            true => Item {
                span: element.span(),
                kind: Kind::TupleElem(element),
            },
            false => self.ty(element.ty()),
        }
    }

    /// Appends the children of `item` to `out`, in the order of Prettier's visitor keys.
    fn children(&self, item: Item<'a>, out: &mut Vec<Item<'a>>) {
        match item.kind {
            Kind::Leaf | Kind::UnmarkedLeaf | Kind::JsxText(_) | Kind::Name => {}
            Kind::LeafIn(span) => out.push(leaf(span)),
            // Of a name that stands for two, the first is printed.
            Kind::Leaves(first, second) if first == second => out.extend([leaf(first), unmarked_leaf(second)]),
            Kind::Leaves(first, second) => out.extend([leaf(first), leaf(second)]),
            Kind::Program => out.extend(self.file.body().iter().map(|it| self.statement(it))),
            Kind::Expr(e) if !self.is_babel && e.is_chain_root() => out.push(Item {
                span: item.span,
                kind: Kind::ChainElement(e),
            }),
            Kind::Expr(e) | Kind::ChainElement(e) | Kind::FlattenedOperand(e) => self.expression_parts(e, out),
            Kind::Parenthesized(e, depth) => out.push(match self.kept_parentheses(e).get(depth) {
                Some(&span) => Item {
                    span,
                    kind: Kind::Parenthesized(e, depth + 1),
                },
                None => Item {
                    span: e.span(),
                    kind: Kind::Expr(e),
                },
            }),
            Kind::Logical(e, count) => self.logical_parts(e, &Self::operands_in_right_side(e), count, out),
            Kind::NonNull(e, inner) => self.non_null_parts(e, inner, out),
            Kind::Stmt(statement) if statement.is_exported() => {
                let span = Span::new(statement.span_without_export().start, self.statement_end(statement, false));
                out.push(Item {
                    // The decorators of a class can be before the `export`.
                    span: match statement.kind() {
                        StmtKind::Class(class) => Self::with_decorators(span, class.modifiers()),
                        _ => span,
                    },
                    kind: Kind::Declaration(statement),
                });
            }
            Kind::Stmt(statement) | Kind::Declaration(statement) => self.declaration_parts(statement, out),
            Kind::Statements(statements) => out.extend(statements.iter().map(|it| self.statement(it))),
            Kind::CatchClause(statement) => {
                if let StmtKind::Try { param, handler, .. } = statement.kind() {
                    out.extend(param.map(|it| self.binding(it.pat(), it.ty(), it.binding_span())));
                    out.extend(handler.map(|it| self.statement(it)));
                }
            }
            Kind::Case(case) => {
                out.extend(case.test().map(|it| self.expr(it)));
                out.extend(case.body().iter().map(|it| self.statement(it)));
            }
            Kind::VarDecl(declaration) => {
                out.push(self.binding(declaration.pat(), declaration.ty(), declaration.binding_span()));
                out.extend(declaration.init().map(|it| self.expr(it)));
            }
            Kind::Func(func, has_name) => self.function_parts(func, has_name, out),
            Kind::ClassBody(class) => out.extend(class.members().iter().map(|it| self.member(it))),
            Kind::Member(member) => self.member_parts(member, out),
            Kind::Prop(prop) => self.prop_parts(prop, out),
            Kind::ImportAttribute(prop) => {
                out.extend(prop.key().map(|key| self.key(key)));
                out.extend(prop.value().map(|it| self.expr(it)));
            }
            Kind::Decorator(e) => out.push(self.expr(e)),
            Kind::ParameterProperty(param) => {
                out.push(self.param_without_modifiers(param));
                self.decorators(param.modifiers(), out);
            }
            Kind::ParameterPattern(param) => {
                match param.default() {
                    Some(default) => {
                        out.extend([self.binding(param.pat(), param.ty(), param.binding_span()), self.expr(default)]);
                    }
                    None => {
                        out.push(self.pattern(param.pat()));
                        out.extend(param.ty().map(|ty| self.type_annotation(ty)));
                    }
                }
                // Otherwise they are those of the `TSParameterProperty`.
                if param.modifiers().iter().all(|it| it.decorator().is_some()) {
                    self.decorators(param.modifiers(), out);
                }
            }
            Kind::Binding(pat, ty, param) => {
                let modifiers = param.map(Param::modifiers);
                match pat.kind() {
                    PatKind::Missing | PatKind::Ident(_) => {}
                    // The decorators of an object pattern are visited first.
                    PatKind::Object(props) => {
                        if let Some(modifiers) = modifiers {
                            self.decorators(modifiers, out);
                        }
                        out.extend(props.iter().map(|it| Item {
                            span: it.span(),
                            kind: Kind::PatProp(it),
                        }));
                    }
                    PatKind::Array(elements) => out.extend(elements.iter().filter_map(|it| self.pattern_element(it))),
                }
                out.extend(ty.map(|ty| self.type_annotation(ty)));
                if let Some(modifiers) = modifiers.filter(|_| !matches!(pat.kind(), PatKind::Object(_))) {
                    self.decorators(modifiers, out);
                }
            }
            Kind::PatternWithDefault(pat, default) => out.extend([self.pattern(pat), self.expr(default)]),
            Kind::RestPattern(pat) => out.push(self.pattern(pat)),
            Kind::PatProp(prop) if prop.is_rest() => out.push(self.pattern(prop.value())),
            Kind::PatProp(prop) => {
                out.extend(prop.key().map(|key| self.key(key)));
                out.push(match prop.default() {
                    Some(default) => Item {
                        span: Span::new(prop.value().span().start, prop.span().end),
                        kind: Kind::PatternWithDefault(prop.value(), default),
                    },
                    None => self.pattern(prop.value()),
                });
            }
            Kind::Type(ty) => self.type_parts(ty, out),
            Kind::TypeAnnotation(ty) => out.push(self.ty(ty)),
            Kind::TypeParams(params) => out.extend(params.iter().map(|it| Item {
                span: it.span(),
                kind: Kind::TypeParam(it),
            })),
            Kind::TypeArgs(args) => out.extend(args.iter().map(|it| self.ty(it))),
            Kind::TypeParam(param) => {
                out.push(leaf(param.name().span()));
                out.extend(param.constraint().map(|it| self.ty(it)));
                out.extend(param.default().map(|it| self.ty(it)));
            }
            Kind::ImportType(ty) => self.import_type_parts(ty, out),
            // `...a: T` is a `TSNamedTupleMember` in a `TSRestType`.
            Kind::TupleElem(element) if element.is_rest() && element.name().is_some() => out.push(Item {
                span: Span::new(element.name().map_or(item.span.start, |it| it.span().start), item.span.end),
                kind: Kind::NamedTupleMember(element),
            }),
            Kind::TupleElem(element) | Kind::NamedTupleMember(element) => {
                out.extend(element.name().map(|it| leaf(it.span())));
                out.push(self.ty(element.ty()));
            }
            Kind::EntityName(name, count) => {
                out.extend(self.entity_name(name, count - 1));
                out.extend(name.get(count - 1).map(|it| leaf(it.span())));
            }
            Kind::ModuleName(module, count) => {
                out.extend(self.module_name(module, count - 1));
                out.extend(Self::nested_module(module, count - 1).map(|it| leaf(it.name_span())));
            }
            Kind::InterfaceBody(interface) => out.extend(interface.members().iter().map(|it| self.member(it))),
            Kind::EnumBody(declaration) => out.extend(declaration.members().iter().map(|it| Item {
                span: it.span(),
                kind: Kind::EnumMember(it),
            })),
            Kind::EnumMember(member) => {
                out.extend(member.key().map(|key| self.key(key)));
                out.extend(member.init().map(|it| self.expr(it)));
            }
            Kind::JsxOpening(jsx) => {
                out.extend(self.jsx_tag(jsx.tag()));
                out.extend(self.type_args(jsx.type_args()));
                out.extend(jsx.attrs().iter().map(|it| Item {
                    span: it.span(),
                    kind: Kind::Prop(it),
                }));
            }
            Kind::JsxClosing(jsx) => out.extend(self.jsx_tag(jsx.close_tag())),
            Kind::JsxContainer(e) => out.push(self.expr(e)),
        }
    }

    fn pattern_element(&self, element: PatElem<'a>) -> Option<Item<'a>> {
        let pat = element.pat()?;
        Some(match (element.is_rest(), element.default()) {
            (true, _) => Item {
                span: element.span(),
                kind: Kind::RestPattern(pat),
            },
            (false, Some(default)) => Item {
                span: element.span(),
                kind: Kind::PatternWithDefault(pat, default),
            },
            (false, None) => self.pattern(pat),
        })
    }
}

// ───────────────────────────── where the cursor is ─────────────────────────────

/// Prettier's `getCursorLocation`. `offset`: of the cursor in the text of `file`.
pub fn locate<'a>(file: &'a File<'a>, offset: u32) -> Region {
    match locate_items(file, offset) {
        (Some(node), None, true) => Region::Node(node.span),
        (before, after, _) => Region::Between {
            before: before.map(|it| it.span),
            after: after.map(|it| it.span),
        },
    }
}

/// The node that the cursor is in and `true`, or the nodes before and after the cursor.
fn locate_items<'a>(file: &'a File<'a>, offset: u32) -> (Option<Item<'a>>, Option<Item<'a>>, bool) {
    let walk = Walk {
        file,
        is_babel: file.is_javascript(),
    };
    let contains = |item: &Item<'a>| item.span.start <= offset && offset <= item.span.end;

    // Breadth first, like `getDescendants`: the last one is the last of those that are deepest.
    let mut containing = vec![Item {
        span: Span::new(0, file.text().len() as u32),
        kind: Kind::Program,
    }];
    let mut children = Vec::new();
    let mut at = 0;
    while let Some(&item) = containing.get(at) {
        children.clear();
        walk.children(item, &mut children);
        containing.extend(children.iter().filter(|it| contains(it)));
        at += 1;
    }

    if let Some(&last) = containing.last() {
        children.clear();
        walk.children(last, &mut children);
        if children.is_empty() {
            return (Some(last), None, true);
        }
    }

    let (mut before, mut after): (Option<Item<'a>>, Option<Item<'a>>) = (None, None);
    while let Some(item) = containing.pop() {
        let (has_before, has_after) = (before.is_some(), after.is_some());
        children.clear();
        walk.children(item, &mut children);
        for &child in &children {
            let span = child.span;
            if !has_before && span.end <= offset && before.is_none_or(|it| span.end > it.span.end) {
                before = Some(child);
            }
            if !has_after && span.start >= offset && after.is_none_or(|it| span.start < it.span.start) {
                after = Some(child);
            }
        }
        if before.is_some() && after.is_some() {
            break;
        }
    }
    (before, after, false)
}

// ───────────────────────────── where the region ends up ─────────────────────────────

/// What tells, while the document is written, where the ends of the region are in it. Prettier's
/// `callPluginPrintFunction` puts `cursor` around what is printed for a node, within its comments.
///
/// The nodes here are not those of ESTree, so what is compared is where they start and end. Of
/// several that qualify, the printer takes the innermost.
#[derive(Copy, Clone)]
pub(crate) struct CursorRegion {
    /// Everything that overlaps this is written on the paths that call `enter` and `exit`.
    extent: Span,
    /// The cursor is in this node.
    node: Extent,
    /// The region starts where this node ends.
    before: Extent,
    /// The region ends where this node starts.
    after: Extent,
    /// The region starts where the children of the JSX element that starts there do.
    starts_with_children_of: u32,
    /// The region ends where the children of the JSX element that starts there do.
    ends_with_children_of: u32,
}

/// Where a node is.
#[derive(Copy, Clone)]
struct Extent {
    span: Span,
    /// Prettier has most statements end before their `;`. Here they are also written as what ends
    /// after it.
    end_with_semicolon: u32,
}

impl Extent {
    /// No node is there.
    const NOWHERE: Extent = Extent {
        span: Span::new(u32::MAX, u32::MAX),
        end_with_semicolon: u32::MAX,
    };

    fn ends_at(self, end: u32) -> bool {
        end == self.span.end || end == self.end_with_semicolon
    }
}

impl CursorRegion {
    pub(crate) const NONE: CursorRegion = CursorRegion {
        extent: Extent::NOWHERE.span,
        node: Extent::NOWHERE,
        before: Extent::NOWHERE,
        after: Extent::NOWHERE,
        starts_with_children_of: u32::MAX,
        ends_with_children_of: u32::MAX,
    };

    fn new<'a>(offset: u32, (first, second, is_node): (Option<Item<'a>>, Option<Item<'a>>, bool)) -> CursorRegion {
        let marked = |item: Option<Item<'a>>| match item {
            None
            | Some(Item {
                // The left side of a rebalanced expression has its operator.
                kind: Kind::UnmarkedLeaf | Kind::JsxText(_) | Kind::FlattenedOperand(_) | Kind::Logical(..),
                ..
            }) => Extent::NOWHERE,
            Some(Item { span, kind }) => Extent {
                span,
                end_with_semicolon: match kind {
                    Kind::Stmt(statement) | Kind::Declaration(statement) => statement.span().end,
                    _ => span.end,
                },
            },
        };
        let element_of = |item: Option<Item<'a>>| match item {
            Some(Item {
                kind: Kind::JsxText(element),
                ..
            }) => element,
            _ => u32::MAX,
        };
        CursorRegion {
            extent: Span::new(
                first.map_or(offset, |it| it.span.start.min(offset)),
                second.or(first).map_or(offset, |it| it.span.end.max(offset)),
            ),
            node: if is_node { marked(first) } else { Extent::NOWHERE },
            before: if is_node { Extent::NOWHERE } else { marked(first) },
            after: marked(second),
            starts_with_children_of: element_of(first),
            // Prettier looks at the node after the cursor only if the one before it is no text.
            ends_with_children_of: match (is_node, element_of(first)) {
                (true, element) => element,
                (false, u32::MAX) => element_of(second),
                (false, _) => u32::MAX,
            },
        }
    }

    #[inline]
    pub(crate) fn is_active(&self) -> bool {
        self.extent.start != u32::MAX
    }

    pub(crate) fn overlaps(&self, span: Span) -> bool {
        span.start <= self.extent.end && self.extent.start <= span.end
    }

    /// Before what is at `span` is written, after the comments that lead it.
    pub(crate) fn enter(&self, span: Span, f: &mut Formatter<'_>) {
        if span.start == self.node.span.start && self.node.ends_at(span.end) {
            f.write_element(FormatElement::Cursor(CursorMark::RegionStart));
        }
        if span.start == self.after.span.start && span.end <= self.after.end_with_semicolon {
            f.write_element(FormatElement::Cursor(CursorMark::RegionEnd));
        }
    }

    /// After what is at `span` is written, before the comments that trail it.
    pub(crate) fn exit(&self, span: Span, f: &mut Formatter<'_>) {
        if span.start == self.node.span.start && self.node.ends_at(span.end) {
            f.write_element(FormatElement::Cursor(CursorMark::RegionEnd));
        }
        if self.before.ends_at(span.end) && span.start >= self.before.span.start {
            f.write_element(FormatElement::Cursor(CursorMark::RegionStart));
        }
    }
}

/// Calls `write`, which writes the node of ESTree at `span`. For a node that is not written by the
/// `impl Format` of a handle: the body of an interface, the text of a template.
#[inline]
pub(crate) fn around_node<'a>(span: Span, f: &mut Formatter<'a>, write: impl FnOnce(&mut Formatter<'a>)) {
    around_node_at(|| span, f, write);
}

/// The same. `span` is only called if there is a cursor.
#[inline]
pub(crate) fn around_node_at<'a>(
    span: impl FnOnce() -> Span,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    if !f.context().cursor.is_active() {
        return write(f);
    }
    let (cursor, span) = (f.context().cursor, span());
    cursor.enter(span, f);
    write(f);
    cursor.exit(span, f);
}

/// Calls `write`, which writes the children of the JSX element that starts at `element` on lines of
/// their own. Prettier does not print the text in an element as nodes. For text that the region
/// starts or ends with, it takes all of the children, if they are written that way.
///
/// `in_group`: they are only on lines of their own if the group that this is in breaks.
#[inline]
pub(crate) fn around_jsx_children<'a>(
    element: u32,
    in_group: bool,
    f: &mut Formatter<'a>,
    write: impl FnOnce(&mut Formatter<'a>),
) {
    if !f.context().cursor.is_active() {
        return write(f);
    }
    let cursor = f.context().cursor;
    let mark = |mark: CursorMark, f: &mut Formatter<'a>| {
        let mark = crate::prelude::format_with(move |f: &mut Formatter<'a>| f.write_element(FormatElement::Cursor(mark)));
        match in_group {
            true => if_group_breaks(&mark).fmt(f),
            false => mark.fmt(f),
        }
    };
    if cursor.starts_with_children_of == element {
        mark(CursorMark::RegionStart, f);
    }
    write(f);
    if cursor.ends_with_children_of == element {
        mark(CursorMark::RegionEnd, f);
    }
}

/// What is written from here on is the node at `span`, up to [`extend_node`]. For a node that writes
/// the comments around it itself.
#[inline]
pub(crate) fn enter_node(span: Span, f: &mut Formatter<'_>) {
    if f.context().cursor.is_active() {
        let cursor = f.context().cursor;
        cursor.enter(span, f);
    }
}

/// What has been written since the node at `span` is part of what Prettier prints for that node:
/// the `;` after a member.
#[inline]
pub(crate) fn extend_node(span: Span, f: &mut Formatter<'_>) {
    if f.context().cursor.is_active() {
        let cursor = f.context().cursor;
        cursor.exit(span, f);
    }
}

// ───────────────────────────── where the cursor is afterwards ─────────────────────────────

/// A UTF-16 code unit, which is what Prettier compares, or the cursor.
type Unit = u32;
const CURSOR: Unit = u32::MAX;

/// Appends `text` as UTF-16 code units. `normalize`: `\r\n` and `\r` are `\n`, as in the text that
/// Prettier parses.
fn push_units(text: &[u8], normalize: bool, out: &mut Vec<Unit>) {
    let mut rest = text;
    while let Some((&first, tail)) = rest.split_first() {
        if first < 0x80 {
            rest = tail;
            match first {
                b'\r' if normalize => {
                    out.push(Unit::from(b'\n'));
                    rest = tail.strip_prefix(b"\n").unwrap_or(tail);
                }
                _ => out.push(Unit::from(first)),
            }
            continue;
        }
        let len = match first {
            0xF0.. => 4,
            0xE0.. => 3,
            _ => 2,
        };
        let (sequence, tail) = rest.split_at(len.min(rest.len()));
        rest = tail;
        let mut code_point = Unit::from(first) & (0x7F >> len);
        for &byte in &sequence[1..] {
            code_point = (code_point << 6) | Unit::from(byte & 0x3F);
        }
        match code_point.checked_sub(0x1_0000) {
            Some(high) => out.extend([0xD800 + (high >> 10), 0xDC00 + (high & 0x3FF)]),
            None => out.push(code_point),
        }
    }
}

/// How many bytes of `text` the first `units` UTF-16 code units of it are.
fn units_to_bytes(text: &[u8], mut units: usize) -> usize {
    let mut at = 0;
    while units > 0 {
        let Some(&first) = text.get(at) else {
            break;
        };
        let (len, width) = match first {
            0xF0.. => (4, 2),
            0xE0.. => (3, 1),
            0xC0.. => (2, 1),
            _ => (1, 1),
        };
        at += len;
        units = units.saturating_sub(width);
    }
    at.min(text.len())
}

/// The furthest that a number of changes gets on a diagonal of the edit graph.
#[derive(Copy, Clone)]
struct Path {
    /// The last unit of the old text that is dealt with. -1: none.
    old_pos: i64,
    /// How many units of the new text were dealt with when the cursor was removed.
    new_units_before_cursor: i64,
}

/// `diffArrays` of jsdiff 9, as far as it takes to tell how much of `new` is before the place where
/// the cursor is removed from `old`. The choices between equally short ways are those of jsdiff.
///
/// Prettier adds up the lengths of what is added or kept before the run of removals with the cursor
/// in it. Removals do not add to that, so it is what has been added or kept when the cursor goes.
///
/// `None` if there are more than `max_differences`: the time it takes is quadratic in their number.
fn units_before_cursor(old: &[Unit], new: &[Unit], max_differences: i64) -> Option<usize> {
    let (old_len, new_len) = (old.len() as i64, new.len() as i64);

    // `extractCommon`. Returns the last unit of the new text that is dealt with.
    let extract_common = |path: &mut Path, diagonal: i64| -> i64 {
        let start = (path.old_pos + 1) as usize;
        let new_start = (path.old_pos - diagonal + 1) as usize;
        let (old_rest, new_rest) = (old.get(start..).unwrap_or_default(), new.get(new_start..).unwrap_or_default());
        let count = old_rest.iter().zip(new_rest).take_while(|(a, b)| a == b).count() as i64;
        path.old_pos += count;
        path.old_pos - diagonal
    };

    let max_edit_length = (old_len + new_len).min(max_differences);
    // `bestPath[diagonal]` is at `diagonal + max_edit_length + 1`.
    let mut best_path: Vec<Option<Path>> = vec![None; (2 * max_edit_length + 3) as usize];
    let slot = |diagonal: i64| (diagonal + max_edit_length + 1) as usize;

    let mut first = Path {
        old_pos: -1,
        new_units_before_cursor: 0,
    };
    let new_pos = extract_common(&mut first, 0);
    if first.old_pos + 1 >= old_len && new_pos + 1 >= new_len {
        return Some(first.new_units_before_cursor as usize);
    }
    best_path[slot(0)] = Some(first);

    let (mut min_diagonal, mut max_diagonal) = (i64::MIN, i64::MAX);
    for edit_length in 1..=max_edit_length {
        let mut diagonal = min_diagonal.max(-edit_length);
        while diagonal <= max_diagonal.min(edit_length) {
            let remove_path = best_path[slot(diagonal - 1)].take();
            let add_path = best_path[slot(diagonal + 1)];
            let can_add = add_path.filter(|path| (0..new_len).contains(&(path.old_pos - diagonal)));
            let can_remove = remove_path.filter(|path| path.old_pos + 1 < old_len);
            let mut base = match (can_add, can_remove) {
                (None, None) => {
                    best_path[slot(diagonal)] = None;
                    diagonal += 2;
                    continue;
                }
                (Some(add), None) => add,
                (Some(add), Some(remove)) if remove.old_pos < add.old_pos => add,
                (_, Some(remove)) => Path {
                    old_pos: remove.old_pos + 1,
                    new_units_before_cursor: match old.get((remove.old_pos + 1) as usize) {
                        Some(&CURSOR) => remove.old_pos - (diagonal - 1) + 1,
                        _ => remove.new_units_before_cursor,
                    },
                },
            };
            let new_pos = extract_common(&mut base, diagonal);
            if base.old_pos + 1 >= old_len && new_pos + 1 >= new_len {
                return Some(base.new_units_before_cursor as usize);
            }
            best_path[slot(diagonal)] = Some(base);
            if base.old_pos + 1 >= old_len {
                max_diagonal = max_diagonal.min(diagonal - 1);
            }
            if new_pos + 1 >= new_len {
                min_diagonal = min_diagonal.max(diagonal + 1);
            }
            diagonal += 2;
        }
    }
    None
}

/// What stands in for the comparison if there are too many differences: the cursor is behind as
/// many characters that are not blanks as before.
fn bytes_before_cursor_by_count(old: &[u8], cursor: usize, new: &[u8]) -> usize {
    let is_blank = |byte: &&u8| byte.is_ascii_whitespace();
    let mut count = old.get(..cursor).unwrap_or(old).iter().filter(|byte| !is_blank(byte)).count();
    for (at, byte) in new.iter().enumerate() {
        if count == 0 {
            return at;
        }
        count -= usize::from(!byte.is_ascii_whitespace());
    }
    new.len()
}

/// Where the cursor is in a text.
#[derive(Copy, Clone)]
struct Offset {
    bytes: u32,
    /// It is between the two UTF-16 code units of the character there.
    is_in_character: bool,
}

/// The end of Prettier's `coreFormat`: where the cursor is in `formatted`, in UTF-16 code units.
///
/// `offset`: where it is in `source`. `marks`: where the start and the end of `region` are in
/// `formatted`, if the printer came by both. `names`: whether the node that `region` starts with, and
/// the one that it ends with, is the name of a property.
fn resolve(
    source: &[u8],
    offset: Offset,
    region: Region,
    names: (bool, bool),
    formatted: &[u8],
    marks: Option<(u32, u32)>,
) -> usize {
    let whole = (Span::new(0, source.len() as u32), Span::new(0, formatted.len() as u32));
    let (old_span, new_span) = match marks {
        // An empty text counts as none.
        Some((start, end)) if start < end && end as usize <= formatted.len() => {
            let old_span = match region {
                Region::Node(span) => span,
                Region::Between { before, after } => {
                    Span::new(before.map_or(0, |it| it.end), after.map_or(source.len() as u32, |it| it.start))
                }
            };
            (old_span, Span::new(start, end))
        }
        _ => whole,
    };
    // Prettier does not print the name of a property as a node if it adds or removes its quotes, so
    // that it does not learn where it ends up.
    let is_quote = |text: &[u8], at: Option<u32>| matches!(at.and_then(|at| text.get(at as usize)), Some(b'"' | b'\''));
    let has_other_quotes = |old: Option<u32>, new: Option<u32>| is_quote(source, old) != is_quote(formatted, new);
    let is_name_with_other_quotes = match region {
        Region::Node(_) => names.0 && has_other_quotes(Some(old_span.start), Some(new_span.start)),
        Region::Between { .. } => {
            (names.0 && has_other_quotes(old_span.start.checked_sub(1), new_span.start.checked_sub(1)))
                || (names.1 && has_other_quotes(Some(old_span.end), Some(new_span.end)))
        }
    };
    let (old_span, new_span) = if is_name_with_other_quotes { whole } else { (old_span, new_span) };
    let old_text = source.get(old_span.start as usize..old_span.end as usize).unwrap_or_default();
    let new_text = formatted.get(new_span.start as usize..new_span.end as usize).unwrap_or_default();
    let new_start = count_units(formatted.get(..new_span.start as usize).unwrap_or_default());
    let cursor = (offset.bytes.saturating_sub(old_span.start) as usize).min(old_text.len());
    let (before_cursor, after_cursor) = old_text.split_at(cursor);

    // Prettier compares with the text that it parses, in which every line break is `\n`.
    let mut old_units = Vec::with_capacity(old_text.len() + 1);
    push_units(before_cursor, true, &mut old_units);
    let units_before = old_units.len() + usize::from(offset.is_in_character);
    push_units(after_cursor, true, &mut old_units);
    let units_before = units_before.min(old_units.len());
    let mut new_units = Vec::with_capacity(new_text.len());
    push_units(new_text, false, &mut new_units);
    if old_units == new_units {
        return new_start + units_before;
    }
    old_units.insert(units_before, CURSOR);

    const MAX_DIFFERENCES: i64 = 20_000;
    new_start
        + units_before_cursor(&old_units, &new_units, MAX_DIFFERENCES).unwrap_or_else(|| {
            let bytes = bytes_before_cursor_by_count(old_text, cursor, new_text);
            count_units(new_text.get(..bytes).unwrap_or(new_text))
        })
}

/// How many UTF-16 code units `text` is.
fn count_units(text: &[u8]) -> usize {
    // Every byte that starts a character is one unit, and one that starts four bytes is two.
    text.iter().map(|&byte| usize::from(byte & 0xC0 != 0x80) + usize::from(byte >= 0xF0)).sum()
}

/// `options.cursor_offset`, which counts UTF-16 code units, as an offset in `source`. Prettier's
/// `normalizeInputAndOptions`: `None` if it is not in the text, of which a byte order mark is no
/// part.
fn offset_in(source: &[u8], options: &FormatOptions) -> Option<Offset> {
    let units = options.cursor_offset? as usize;
    if units > count_units(source) || (units == 0 && source.starts_with(b"\xEF\xBB\xBF")) {
        return None;
    }
    // The bytes of the characters that end at or before it.
    let mut offset = units_to_bytes(source, units);
    let is_in_character = count_units(source.get(..offset)?) > units;
    if is_in_character {
        offset = offset.saturating_sub(4);
    }
    // After `\r\n` has become `\n`, an offset between the two is behind it.
    let is_in_line_break = offset > 0 && source.get(offset - 1..=offset) == Some(b"\r\n");
    Some(Offset {
        bytes: (offset + usize::from(is_in_line_break)) as u32,
        is_in_character,
    })
}

/// Appends the formatted text of `file` to `out`. Returns where the cursor, which is at
/// `options.cursor_offset` in the text of `file`, is in what is appended, in UTF-16 code units like
/// the option. `None` without the option, if it is not in the text, and if the text is blank.
pub fn format_with_cursor<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> Result<Option<u32>, FormatError> {
    format_with(file, options, scratch, out, false, crate::js::format_file)
}

/// The same for the document that `write` writes: Prettier's `coreFormat`.
///
/// `is_aligned`: its `addAlignmentSize > 0`. Of what is printed, the blanks at both ends are left
/// out, and a line break ends it.
pub(crate) fn format_with<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    is_aligned: bool,
    write: impl FnOnce(&'a File<'a>, &mut Formatter<'a>),
) -> Result<Option<u32>, FormatError> {
    let source = file.text();
    let offset = offset_in(source, options).filter(|_| !source.trim_ascii().is_empty());
    let items = offset.map(|offset| locate_items(file, offset.bytes));
    let cursor = offset.zip(items).map_or(CursorRegion::NONE, |(offset, items)| CursorRegion::new(offset.bytes, items));

    let start = out.len();
    let [mut first, mut second] = crate::ir::run::format_with_marks(file, options, cursor, scratch, out, write)?;
    // Without a node on one side, the region goes to that end of the document.
    match items {
        Some((None, Some(_), _)) => first = Some(0),
        Some((Some(_), None, false)) => second = Some((out.len() - start) as u32),
        _ => {}
    }
    if is_aligned {
        let printed = out.get(start..).unwrap_or_default();
        let leading = printed.len() - printed.trim_ascii_start().len();
        let end = printed.trim_ascii_end().len().max(leading);
        let trimmed = |mark: u32| mark.clamp(leading as u32, end as u32) - leading as u32;
        (first, second) = (first.map(trimmed), second.map(trimmed));
        out.truncate(start + end);
        out.drain(start..start + leading);
        out.extend_from_slice(options.line_ending.resolve(source).as_bytes());
    }

    let Some(offset) = offset else {
        return Ok(None);
    };
    let formatted = out.get(start..).unwrap_or_default();
    let is_name = |item: Option<Item<'a>>| matches!(item, Some(Item { kind: Kind::Name, .. }));
    let names = items.map_or((false, false), |(first, second, _)| (is_name(first), is_name(second)));
    Ok(Some(resolve(source, offset, locate(file, offset.bytes), names, formatted, first.zip(second)) as u32))
}

/// Where the cursor, which is at `options.cursor_offset` in `source`, is in `formatted`, which is what
/// has become of all of `source`: what Prettier says if it does not learn where the part around the
/// cursor ends up. For the languages whose trees are not looked at here.
pub fn cursor_in_formatted_text(source: &[u8], options: &FormatOptions, formatted: &[u8]) -> Option<u32> {
    let offset = offset_in(source, options).filter(|_| !source.trim_ascii().is_empty())?;
    let everything = Region::Between {
        before: None,
        after: None,
    };
    Some(resolve(source, offset, everything, (false, false), formatted, None) as u32)
}
