//! ESLint's `sourceCode.getNodeByRangeIndex(offset).type`.

use super::estree_compat::{estree_type_name, get_node_by_range_index};
use crate::ast::{
    Class, EntityName, Expr, ExprKind, File, FnKind, Func, Ident, ImportAttributes,
    ImportEqualsTarget, Jsx, JsxChild, Key, KeyKind, List, Member, Modifier, ModuleName, Node,
    Param, Prop, Stmt, StmtKind, TypeKind, TypeNode,
};
use crate::span::Span;
use crate::tokens::skip_trivia;
use bun_core::strings;

/// An offset, and what is asked about it.
#[derive(Copy, Clone)]
struct At(u32);

impl At {
    #[inline]
    fn is_in(self, span: Span) -> bool {
        span.contains_offset(self.0)
    }

    #[inline]
    fn is_in_some(self, span: Option<Span>) -> bool {
        span.is_some_and(|it| self.is_in(it))
    }

    /// `Identifier`, or `Literal` for a name that is written as a string.
    fn ident(self, ident: Ident<'_>) -> Option<&'static str> {
        self.is_in(ident.span()).then(|| match ident.is_string() {
            true => "Literal",
            false => "Identifier",
        })
    }

    fn some_ident(self, ident: Option<Ident<'_>>) -> Option<&'static str> {
        self.ident(ident?)
    }

    /// The key of a property or a member, unless it is an expression in brackets, which is a node.
    fn key<'a>(self, key: Option<Key<'a>>, file: &File<'a>) -> Option<&'static str> {
        let key = key?;
        let span = key.inner_span(file);
        if !self.is_in(span) {
            return None;
        }
        Some(match key.kind() {
            KeyKind::Ident(_) => "Identifier",
            KeyKind::Private(_) => "PrivateIdentifier",
            KeyKind::ComputedString(_) if file.slice(span).starts_with(b"`") => "TemplateElement",
            KeyKind::String(_)
            | KeyKind::Number(_)
            | KeyKind::ComputedString(_)
            | KeyKind::ComputedNumber(_) => "Literal",
            KeyKind::Computed(_) => return None,
        })
    }

    /// The `: T` around a type.
    fn annotation(self, ty: Option<TypeNode<'_>>) -> Option<&'static str> {
        self.is_in(ty?.annotation_span())
            .then_some("TSTypeAnnotation")
    }

    fn decorator<'a>(self, modifiers: List<'a, Modifier<'a>>) -> Option<&'static str> {
        modifiers
            .iter()
            .any(|it| it.decorator().is_some() && self.is_in(it.span()))
            .then_some("Decorator")
    }

    /// `A.B.C`. `qualified` is what the dots are in.
    fn entity_name(self, name: EntityName<'_>, qualified: &'static str) -> Option<&'static str> {
        self.is_in(name.span())
            .then(|| match name.parts().any(|it| self.is_in(it.span())) {
                true => "Identifier",
                false => qualified,
            })
    }

    fn type_args<'a>(self, args: List<'a, TypeNode<'a>>) -> Option<&'static str> {
        self.is_in_some(args.angle_brackets_span())
            .then_some("TSTypeParameterInstantiation")
    }

    fn attributes(self, attributes: Option<ImportAttributes<'_>>) -> Option<&'static str> {
        let entry = attributes?
            .entries()
            .iter()
            .find(|it| self.is_in(it.span()))?;
        Some(
            self.key(entry.key(), entry.file())
                .unwrap_or("ImportAttribute"),
        )
    }

    /// `export` and `export default` before a declaration.
    fn export(self, statement: Stmt<'_>) -> Option<&'static str> {
        let export = statement.export_span()?;
        (self.is_in(export) && self.0 < statement.span_without_export().start).then(|| {
            match statement.is_default_export() {
                true => "ExportDefaultDeclaration",
                false => "ExportNamedDeclaration",
            }
        })
    }

    fn stmt(self, statement: Stmt<'_>) -> Option<&'static str> {
        if let Some(export) = self.export(statement) {
            return Some(export);
        }
        let source = || {
            self.is_in_some(statement.module_specifier_span())
                .then_some("Literal")
        };
        match statement.kind() {
            StmtKind::Try { .. } => self
                .is_in_some(statement.catch_clause_span())
                .then_some("CatchClause"),
            StmtKind::Labeled { .. } | StmtKind::Break(_) | StmtKind::Continue(_) => {
                self.some_ident(statement.label())
            }
            StmtKind::Import(import) => self
                .some_ident(import.default())
                .or_else(|| self.some_ident(import.namespace()))
                .or_else(|| {
                    self.is_in_some(import.namespace_span())
                        .then_some("ImportNamespaceSpecifier")
                })
                .or_else(source)
                .or_else(|| self.attributes(import.attributes())),
            StmtKind::ExportNamed(export) => {
                source().or_else(|| self.attributes(export.attributes()))
            }
            StmtKind::ExportStar { alias, .. } => self
                .some_ident(alias)
                .or_else(source)
                .or_else(|| self.attributes(statement.import_attributes())),
            StmtKind::Interface(interface) => self
                .ident(interface.name())
                .or_else(|| {
                    self.is_in_some(interface.type_params().angle_brackets_span())
                        .then_some("TSTypeParameterDeclaration")
                })
                .or_else(|| {
                    self.is_in(interface.body_span())
                        .then_some("TSInterfaceBody")
                }),
            StmtKind::TypeAlias(alias) => self.ident(alias.name()).or_else(|| {
                self.is_in_some(alias.type_params().angle_brackets_span())
                    .then_some("TSTypeParameterDeclaration")
            }),
            StmtKind::Enum(it) => self
                .ident(it.name())
                .or_else(|| self.is_in(it.body_span()).then_some("TSEnumBody")),
            StmtKind::Module(module) => {
                let mut part = Some(module);
                while let Some(it) = part {
                    match it.name() {
                        ModuleName::Ident(name) | ModuleName::String(name) => {
                            if let Some(found) = self.ident(name) {
                                return Some(found);
                            }
                        }
                        ModuleName::Global if self.is_in(it.name_span()) => {
                            return Some("Identifier");
                        }
                        ModuleName::Global => {}
                    }
                    part = it.nested();
                }
                let innermost = module.innermost();
                if self.is_in_some(innermost.body_span()) {
                    return Some("TSModuleBlock");
                }
                let names = Span::new(module.name_span().start, innermost.name_span().end);
                self.is_in(names).then_some("TSQualifiedName")
            }
            StmtKind::ImportEquals(import) => {
                self.ident(import.name())
                    .or_else(source)
                    .or_else(|| match import.target() {
                        ImportEqualsTarget::Require(_) => self
                            .is_in_some(import.require_span())
                            .then_some("TSExternalModuleReference"),
                        ImportEqualsTarget::Entity(name) => {
                            self.entity_name(name, "TSQualifiedName")
                        }
                    })
            }
            StmtKind::ExportAsNamespace(_) => self.some_ident(statement.namespace_export_name()),
            _ => None,
        }
    }

    fn func(self, func: Func<'_>) -> Option<&'static str> {
        let owner = func.owner();
        // The span of a `Func` starts with the method, the property or the `export` that it is in.
        let outer = || match owner {
            Node::Member(member) => Some(
                self.member(member)
                    .unwrap_or_else(|| estree_type_name(owner)),
            ),
            Node::Stmt(statement) => self.export(statement),
            Node::Expr(e) => match e.parent() {
                parent @ Node::Prop(prop) => {
                    Some(self.prop(prop).unwrap_or_else(|| estree_type_name(parent)))
                }
                _ => None,
            },
            _ => None,
        };
        if !self.is_in(func.estree_span()) {
            return outer();
        }
        self.some_ident(func.name())
            .or_else(|| {
                self.is_in_some(func.type_params().angle_brackets_span())
                    .then_some("TSTypeParameterDeclaration")
            })
            .or_else(|| self.annotation(func.return_type()))
            .or_else(|| {
                (func.kind() != FnKind::StaticBlock && self.is_in_some(func.body_span()))
                    .then_some("BlockStatement")
            })
            .or_else(|| match owner {
                // A signature is one node with its function.
                Node::Member(member) => self.member(member),
                _ => None,
            })
    }

    fn class(self, class: Class<'_>) -> Option<&'static str> {
        self.decorator(class.modifiers())
            .or_else(|| self.export(class.owner().as_stmt()?))
            .or_else(|| self.some_ident(class.name()))
            .or_else(|| {
                self.is_in_some(class.type_params().angle_brackets_span())
                    .then_some("TSTypeParameterDeclaration")
            })
            .or_else(|| self.type_args(class.extends_args()))
            .or_else(|| self.is_in(class.body_span()).then_some("ClassBody"))
    }

    fn member(self, member: Member<'_>) -> Option<&'static str> {
        self.decorator(member.modifiers())
            .or_else(|| self.key(member.key(), member.file()))
            .or_else(|| self.some_ident(member.constructor_keyword()))
            .or_else(|| self.annotation(member.ty()))
    }

    /// What the braces of `{e}`, `{}` and `{...e}` in JSX are.
    fn jsx_container(self, e: Expr<'_>) -> Option<&'static str> {
        let braces = e.jsx_container_span().filter(|it| self.is_in(*it))?;
        Some(match e.kind() {
            ExprKind::Missing if self.is_in(braces.shrink(1, 1)) => "JSXEmptyExpression",
            ExprKind::Spread(_) if !matches!(e.parent(), Node::Prop(_)) => "JSXSpreadChild",
            _ => "JSXExpressionContainer",
        })
    }

    /// `a`, `a-b` or `a:b` in JSX.
    fn jsx_name(self, span: Span, file: &File<'_>) -> Option<&'static str> {
        self.is_in(span)
            .then(|| match file.text().get(self.0 as usize) {
                Some(b':') => "JSXNamespacedName",
                _ if strings::contains_char(file.slice(span), b':')
                    && file
                        .text()
                        .get(self.0 as usize)
                        .is_some_and(u8::is_ascii_whitespace) =>
                {
                    "JSXNamespacedName"
                }
                _ => "JSXIdentifier",
            })
    }

    fn prop(self, prop: Prop<'_>) -> Option<&'static str> {
        let file = prop.file();
        match prop.is_jsx_attribute() {
            true => (prop.key())
                .and_then(|key| self.jsx_name(key.span(file), file))
                .or_else(|| self.jsx_container(prop.value()?)),
            false => self.key(prop.key(), file),
        }
    }

    fn param(self, param: Param<'_>) -> Option<&'static str> {
        let pattern = || estree_type_name(Node::Pat(param.pat()));
        self.decorator(param.modifiers())
            .or_else(|| self.annotation(param.ty()))
            .or_else(|| match param.default() {
                _ if param.is_rest() => None,
                _ if self.is_in(param.binding_span()) => Some(pattern()),
                Some(_) if self.is_in(param.span_without_modifiers()) => Some("AssignmentPattern"),
                _ => None,
            })
    }

    fn jsx(self, jsx: Jsx<'_>) -> Option<&'static str> {
        let is_fragment = jsx.is_fragment();
        if self.is_in(jsx.opening_span()) {
            return self.type_args(jsx.type_args()).or(Some(match is_fragment {
                true => "JSXOpeningFragment",
                false => "JSXOpeningElement",
            }));
        }
        if self.is_in_some(jsx.closing_span()) {
            return Some(match is_fragment {
                true => "JSXClosingFragment",
                false => "JSXClosingElement",
            });
        }
        jsx.children_with_whitespace()
            .find_map(|child| match child {
                JsxChild::Whitespace(span) => self.is_in(span).then_some("JSXText"),
                JsxChild::Expr(e) => self.jsx_container(e),
            })
    }

    fn expr(self, e: Expr<'_>) -> Option<&'static str> {
        match e.kind() {
            ExprKind::Dot { name, .. } => self.is_in(name.span()).then(|| match () {
                () if name.bytes().starts_with(b"#") => "PrivateIdentifier",
                () if e.is_jsx_tag_name() => "JSXIdentifier",
                () => "Identifier",
            }),
            ExprKind::String(_) if e.is_jsx_tag_name() => self.jsx_name(e.span(), e.file()),
            ExprKind::Template(template) => (0..template.quasi_count())
                .any(|i| self.is_in(template.quasi_span(i)))
                .then_some("TemplateElement"),
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                self.type_args(call.type_args())
            }
            ExprKind::Instantiation { type_args, .. } => self.type_args(type_args),
            ExprKind::Jsx(jsx) => self.jsx(jsx),
            ExprKind::AsConst(_) => self
                .is_in_some(e.const_keyword_span())
                .then_some("Identifier"),
            ExprKind::ImportMeta | ExprKind::NewTarget => {
                let (meta, property) = e.meta_property_spans()?;
                (self.is_in(meta) || self.is_in(property)).then_some("Identifier")
            }
            _ => None,
        }
    }

    fn ty(self, ty: TypeNode<'_>) -> Option<&'static str> {
        let text = ty.text();
        match ty.kind() {
            TypeKind::Ref { name, args } => {
                let qualified = match estree_type_name(Node::Type(ty)) {
                    "TSTypeReference" => "TSQualifiedName",
                    _ => "MemberExpression",
                };
                self.entity_name(name, qualified)
                    .or_else(|| self.type_args(args))
            }
            TypeKind::Heritage { args, .. } | TypeKind::Typeof { args, .. } => self.type_args(args),
            TypeKind::StringLit(_) if text.starts_with(b"`") => Some("TemplateElement"),
            TypeKind::NumberLit(_) | TypeKind::BigIntLit { .. }
                if text.starts_with(b"-")
                    && self.0 < skip_trivia(ty.file().text(), ty.span().start + 1) =>
            {
                Some("UnaryExpression")
            }
            TypeKind::StringLit(_)
            | TypeKind::NumberLit(_)
            | TypeKind::BigIntLit { .. }
            | TypeKind::BoolLit(_) => Some("Literal"),
            TypeKind::Template(_) => {
                let template = ty.as_template()?;
                (0..template.quasi_count())
                    .any(|i| self.is_in(template.quasi_span(i)))
                    .then_some("TemplateElement")
            }
            TypeKind::Import {
                name,
                args,
                is_typeof,
                ..
            } => self
                .is_in_some(ty.import_source_span())
                .then_some("Literal")
                .or_else(|| self.entity_name(name, "TSQualifiedName"))
                .or_else(|| self.type_args(args))
                .or_else(|| self.attributes(ty.import_attributes()))
                .or_else(|| {
                    (is_typeof && self.is_in_some(ty.import_span())).then_some("TSImportType")
                }),
            TypeKind::Predicate { param, .. } => {
                let name = ty.predicate_param()?;
                self.is_in(name.span()).then(|| match param.is("this") {
                    true => "TSThisType",
                    false => "Identifier",
                })
            }
            TypeKind::UniqueSymbol => self
                .is_in_some(ty.unique_symbol_keyword_span())
                .then_some("TSSymbolKeyword"),
            _ => None,
        }
    }

    /// The type of the innermost node of ESTree in `node` that is not a node here.
    fn inside(self, node: Node<'_>) -> Option<&'static str> {
        match node {
            Node::File(_) | Node::Pat(_) | Node::PatElem(_) | Node::Case(_) => None,
            Node::Stmt(statement) => self.stmt(statement),
            Node::Expr(e) => self.expr(e),
            Node::Type(ty) => self.ty(ty),
            Node::Func(func) => self.func(func),
            Node::Class(class) => self.class(class),
            Node::Member(member) => self.member(member),
            Node::Prop(prop) => self.prop(prop),
            Node::Param(param) => self.param(param),
            Node::PatProp(prop) => self.key(prop.key(), prop.file()).or_else(|| {
                (prop.default().is_some() && self.0 >= prop.value().span().start)
                    .then_some("AssignmentPattern")
            }),
            Node::VarDecl(declaration) => self.annotation(declaration.ty()).or_else(|| {
                self.is_in(declaration.binding_span())
                    .then(|| estree_type_name(Node::Pat(declaration.pat())))
            }),
            Node::TypeParam(param) => self.ident(param.name()).or_else(|| match param.parent() {
                Node::Type(ty) if matches!(ty.kind(), TypeKind::Mapped(_)) => Some("TSMappedType"),
                _ => None,
            }),
            Node::EnumMember(member) => self.key(member.key(), member.file()),
            Node::ImportSpec(specifier) => self
                .ident(specifier.imported())
                .or_else(|| self.ident(specifier.local())),
            Node::ExportSpec(specifier) => self
                .ident(specifier.local())
                .or_else(|| self.ident(specifier.exported())),
            Node::TupleElem(element) => {
                let name = element.name()?;
                self.ident(name).or_else(|| {
                    (element.is_rest() && self.0 >= name.start()).then_some("TSNamedTupleMember")
                })
            }
        }
    }
}

/// ESLint's `sourceCode.getNodeByRangeIndex(offset).type`, exactly as ESTree has it: also
/// `BlockStatement` for the body of a function, `ClassBody`, `CatchClause`, `TemplateElement`,
/// `JSXEmptyExpression`, `TSTypeAnnotation`, `Identifier` for a name, and the other types that are
/// no nodes here. It is `"Program"` where ESLint answers `null`.
///
/// It goes down from the file to the innermost node, as upstream, and allocates nothing.
pub fn estree_type_at<'a>(file: &'a File<'a>, offset: u32) -> &'static str {
    let node = get_node_by_range_index(file, offset);
    At(offset)
        .inside(node)
        .unwrap_or_else(|| estree_type_name(node))
}
