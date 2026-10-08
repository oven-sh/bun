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

use crate::js::utils::typescript::without_lone_operator;
use crate::ir::element::{CursorMark, FormatElement};
use crate::ir::formatter::Formatter;
use crate::{FormatError, FormatOptions, Scratch};
use bun_lint::ast::{
    Class, EntityName, Enum, EnumMember, ExportSpec, Expr, ExprKind, File, FnBody, Func, Ident, ImportEqualsTarget,
    ImportSpec, Interface, Jsx, JsxChild, Key, KeyKind, List, Member, MemberKind, Modifier, Module, Param, Pat,
    PatElem, PatKind, PatProp, Prop, PropKind, Stmt, StmtKind, TupleElem, TypeKind, TypeNode, TypeParam, VarDecl,
};
use bun_lint::span::Span;
use bun_lint::tokens::skip_trivia_back;

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
    /// A leaf that Prettier does not print as a node of its own, so that it does not learn where it
    /// ends up: the second name of `import { a }`, the text in a JSX element.
    UnmarkedLeaf,
    /// Its only child is a leaf.
    LeafIn(Span),
    /// Its children are two leaves.
    Leaves(Span, Span),
    Program,
    Expr(Expr<'a>),
    /// Without the `ChainExpression` around it.
    ChainElement(Expr<'a>),
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
        Item {
            span: e.span(),
            kind: Kind::Expr(e),
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
            _ => leaf(span),
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
            (None, _) if e.is_jsx_text() => unmarked_leaf(e.span()),
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
                let operands = e.sequence();
                match (operands.len(), e.kind()) {
                    (1, ExprKind::Binary { left, right, .. }) => out.extend([self.expr(left), self.expr(right)]),
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
                    JsxChild::Expr(child) => self.jsx_child(child),
                    JsxChild::Whitespace(span) => unmarked_leaf(span),
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
                    kind: Kind::LeafIn(Span::new(bun_lint::tokens::skip_trivia(self.text(), span.start + 1), span.end)),
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
            Kind::Leaf | Kind::UnmarkedLeaf => {}
            Kind::LeafIn(span) => out.push(leaf(span)),
            // Of a name that stands for two, the first is printed.
            Kind::Leaves(first, second) if first == second => out.extend([leaf(first), unmarked_leaf(second)]),
            Kind::Leaves(first, second) => out.extend([leaf(first), leaf(second)]),
            Kind::Program => out.extend(self.file.body().iter().map(|it| self.statement(it))),
            Kind::Expr(e) if !self.is_babel && e.is_chain_root() => out.push(Item {
                span: item.span,
                kind: Kind::ChainElement(e),
            }),
            Kind::Expr(e) | Kind::ChainElement(e) => self.expression_parts(e, out),
            Kind::NonNull(e, inner) => self.non_null_parts(e, inner, out),
            Kind::Stmt(statement) if statement.is_exported() => out.push(Item {
                span: Span::new(statement.span_without_export().start, self.statement_end(statement, false)),
                kind: Kind::Declaration(statement),
            }),
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
    node: Span,
    /// The region starts where this node ends.
    before: Span,
    /// The region ends where this node starts.
    after: Span,
}

/// No node is there.
const NOWHERE: Span = Span::new(u32::MAX, u32::MAX);

impl CursorRegion {
    pub(crate) const NONE: CursorRegion = CursorRegion {
        extent: NOWHERE,
        node: NOWHERE,
        before: NOWHERE,
        after: NOWHERE,
    };

    fn new<'a>(offset: u32, (first, second, is_node): (Option<Item<'a>>, Option<Item<'a>>, bool)) -> CursorRegion {
        let marked = |item: Option<Item<'a>>| match item {
            Some(item) if !matches!(item.kind, Kind::UnmarkedLeaf) => item.span,
            _ => NOWHERE,
        };
        CursorRegion {
            extent: Span::new(
                first.map_or(offset, |it| it.span.start.min(offset)),
                second.or(first).map_or(offset, |it| it.span.end.max(offset)),
            ),
            node: if is_node { marked(first) } else { NOWHERE },
            before: if is_node { NOWHERE } else { marked(first) },
            after: marked(second),
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
        if span == self.node {
            f.write_element(FormatElement::Cursor(CursorMark::RegionStart));
        }
        if span.start == self.after.start && span.end <= self.after.end {
            f.write_element(FormatElement::Cursor(CursorMark::RegionEnd));
        }
    }

    /// After what is at `span` is written, before the comments that trail it.
    pub(crate) fn exit(&self, span: Span, f: &mut Formatter<'_>) {
        if span == self.node {
            f.write_element(FormatElement::Cursor(CursorMark::RegionEnd));
        }
        if span.end == self.before.end && span.start >= self.before.start {
            f.write_element(FormatElement::Cursor(CursorMark::RegionStart));
        }
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

#[derive(Copy, Clone, PartialEq, Eq)]
enum Change {
    Common,
    Added,
    Removed,
}

/// A run of changes of one kind, and the index of the one before it.
#[derive(Copy, Clone)]
struct Component {
    count: u32,
    change: Change,
    previous: u32,
}

const NO_COMPONENT: u32 = u32::MAX;

#[derive(Copy, Clone)]
struct Path {
    /// -1 is before the first.
    old_pos: i64,
    last: u32,
}

/// `diffArrays` of jsdiff 9, as far as it takes to tell how much of `new` is before the place where
/// the cursor is removed from `old`. The choices between equally short ways are those of jsdiff.
///
/// `None` if there are more than `max_differences`: it is quadratic in their number, in time and in
/// memory.
fn units_before_cursor(old: &[Unit], new: &[Unit], max_differences: i64) -> Option<usize> {
    let (old_len, new_len) = (old.len() as i64, new.len() as i64);
    let mut components: Vec<Component> = Vec::new();

    // `extractCommon`
    let extract_common = |path: &mut Path, diagonal: i64, components: &mut Vec<Component>| -> i64 {
        let mut old_pos = path.old_pos;
        let mut new_pos = old_pos - diagonal;
        let mut count = 0;
        while new_pos + 1 < new_len && old_pos + 1 < old_len && old[(old_pos + 1) as usize] == new[(new_pos + 1) as usize] {
            new_pos += 1;
            old_pos += 1;
            count += 1;
        }
        if count > 0 {
            components.push(Component {
                count,
                change: Change::Common,
                previous: path.last,
            });
            path.last = components.len() as u32 - 1;
        }
        path.old_pos = old_pos;
        new_pos
    };
    // `addToPath`
    let add_to_path = |path: Path, change: Change, components: &mut Vec<Component>| -> Path {
        let component = match components.get(path.last as usize) {
            Some(last) if last.change == change => Component {
                count: last.count + 1,
                ..*last
            },
            _ => Component {
                count: 1,
                change,
                previous: path.last,
            },
        };
        components.push(component);
        Path {
            old_pos: path.old_pos + i64::from(change == Change::Removed),
            last: components.len() as u32 - 1,
        }
    };

    let max_edit_length = (old_len + new_len).min(max_differences);
    // `bestPath[diagonal]` is at `diagonal + max_edit_length + 1`.
    let mut best_path: Vec<Option<Path>> = vec![None; (2 * max_edit_length + 3) as usize];
    let slot = |diagonal: i64| (diagonal + max_edit_length + 1) as usize;

    let mut first = Path {
        old_pos: -1,
        last: NO_COMPONENT,
    };
    let new_pos = extract_common(&mut first, 0, &mut components);
    let mut done = (first.old_pos + 1 >= old_len && new_pos + 1 >= new_len).then_some(first.last);
    best_path[slot(0)] = Some(first);

    let (mut min_diagonal, mut max_diagonal) = (i64::MIN, i64::MAX);
    let mut edit_length = 1;
    'search: while done.is_none() && edit_length <= max_edit_length {
        let mut diagonal = min_diagonal.max(-edit_length);
        while diagonal <= max_diagonal.min(edit_length) {
            let remove_path = best_path[slot(diagonal - 1)].take();
            let add_path = best_path[slot(diagonal + 1)];
            let can_add = add_path.is_some_and(|path| {
                let new_pos = path.old_pos - diagonal;
                0 <= new_pos && new_pos < new_len
            });
            let can_remove = remove_path.is_some_and(|path| path.old_pos + 1 < old_len);
            let mut base = match (add_path, remove_path) {
                _ if !can_add && !can_remove => {
                    best_path[slot(diagonal)] = None;
                    diagonal += 2;
                    continue;
                }
                (Some(add), remove) if !can_remove || (can_add && remove.is_some_and(|it| it.old_pos < add.old_pos)) => {
                    add_to_path(add, Change::Added, &mut components)
                }
                (_, Some(remove)) => add_to_path(remove, Change::Removed, &mut components),
                _ => break 'search,
            };
            let new_pos = extract_common(&mut base, diagonal, &mut components);
            if base.old_pos + 1 >= old_len && new_pos + 1 >= new_len {
                done = Some(base.last);
                break 'search;
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
        edit_length += 1;
    }

    // The components are linked from the last to the first.
    let mut order = Vec::new();
    let mut at = done?;
    while let Some(component) = components.get(at as usize) {
        order.push(*component);
        at = component.previous;
    }
    let cursor = old.iter().position(|&unit| unit == CURSOR)?;
    let (mut old_pos, mut new_pos) = (0, 0);
    for component in order.iter().rev() {
        let count = component.count as usize;
        match component.change {
            Change::Removed if (old_pos..old_pos + count).contains(&cursor) => break,
            Change::Removed => old_pos += count,
            Change::Added => new_pos += count,
            Change::Common => {
                old_pos += count;
                new_pos += count;
            }
        }
    }
    Some(new_pos)
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

/// The end of Prettier's `coreFormat`: where the cursor is in `formatted`.
///
/// `offset`: where it is in `source`. `marks`: where the start and the end of `region` are in
/// `formatted`, if the printer came by both.
fn resolve(source: &[u8], offset: u32, region: Region, formatted: &[u8], marks: Option<(u32, u32)>) -> u32 {
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
    let old_text = source.get(old_span.start as usize..old_span.end as usize).unwrap_or_default();
    let new_text = formatted.get(new_span.start as usize..new_span.end as usize).unwrap_or_default();
    let cursor = (offset.saturating_sub(old_span.start) as usize).min(old_text.len());
    let (before_cursor, after_cursor) = old_text.split_at(cursor);

    // Prettier compares with the text that it parses, in which every line break is `\n`.
    let mut old_units = Vec::with_capacity(old_text.len() + 1);
    push_units(before_cursor, true, &mut old_units);
    let units_before = old_units.len();
    push_units(after_cursor, true, &mut old_units);
    let mut new_units = Vec::with_capacity(new_text.len());
    push_units(new_text, false, &mut new_units);
    if old_units == new_units {
        return new_span.start + units_to_bytes(new_text, units_before) as u32;
    }
    old_units.insert(units_before, CURSOR);

    const MAX_DIFFERENCES: i64 = 1500;
    let bytes = match units_before_cursor(&old_units, &new_units, MAX_DIFFERENCES) {
        Some(units) => units_to_bytes(new_text, units),
        None => bytes_before_cursor_by_count(old_text, cursor, new_text),
    };
    new_span.start + bytes as u32
}

/// How many UTF-16 code units `text` is.
fn count_units(text: &[u8]) -> usize {
    // Every byte that starts a character is one unit, and one that starts four bytes is two.
    text.iter().map(|&byte| usize::from(byte & 0xC0 != 0x80) + usize::from(byte >= 0xF0)).sum()
}

/// `options.cursor_offset`, which counts UTF-16 code units, as an offset in `source`. Prettier's
/// `normalizeInputAndOptions`: `None` if it is not in the text, of which a byte order mark is no
/// part.
fn offset_in(source: &[u8], options: &FormatOptions) -> Option<u32> {
    let units = options.cursor_offset? as usize;
    let offset = units_to_bytes(source, units);
    if count_units(source.get(..offset)?) != units || (units == 0 && source.starts_with(b"\xEF\xBB\xBF")) {
        return None;
    }
    // After `\r\n` has become `\n`, an offset between the two is behind it.
    let is_in_line_break = offset > 0 && source.get(offset - 1..=offset) == Some(b"\r\n");
    Some((offset + usize::from(is_in_line_break)) as u32)
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
    let items = offset.map(|offset| locate_items(file, offset));
    let cursor = offset.zip(items).map_or(CursorRegion::NONE, |(offset, items)| CursorRegion::new(offset, items));

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
    let new_offset = resolve(source, offset, locate(file, offset), formatted, first.zip(second)) as usize;
    Ok(Some(count_units(formatted.get(..new_offset).unwrap_or(formatted)) as u32))
}
