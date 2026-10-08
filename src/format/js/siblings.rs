//! Where the next sibling of a node starts.
//!
//! [`Comments::get_trailing_comments`](super::comments::Comments::get_trailing_comments) needs it
//! to tell the comments that trail a node from those that lead the next one. In oxc every node
//! carries it around. Here it is only computed for a node that has a comment after it.
//!
//! The rules, which are those of oxc's generated `AstNode` accessors:
//! - It is the start of the next child of the parent that is there, in the order of the fields.
//! - After the last element of a list it is 0, "there is none", even if other fields follow. The
//!   lists that a rest element can follow, and directives, are the exception.
//! - After the last child, it is that of the parent. If the parent is a statement, a pattern or a
//!   list of parameters, it is 0.

use super::ast_nodes::{AsAstNodes, AstNodes, ExpressionStatement, type_arguments_of, type_parameters_of};
use bun_lint::ast::{
    ExprKind, FnBody, Func, Handle, ImportEqualsTarget, Key, List, Member, ModuleName, Node, PatKind,
    StmtKind, TypeKind,
};
use bun_lint::span::{Span, Spanned};

/// Goes through the children of a node in order, looking for the one after `me`.
struct Finder {
    me: Span,
    is_found: bool,
    following: Option<u32>,
}

impl Finder {
    /// A child that is there or not.
    fn one(&mut self, child: Option<Span>) -> &mut Self {
        if self.following.is_some() {
            return self;
        }
        match child {
            Some(child) if self.is_found => self.following = Some(child.start),
            Some(child) if child.contains(self.me) => self.is_found = true,
            _ => {}
        }
        self
    }

    /// A child that Prettier has no node for, like the parentheses around parameters. What is before
    /// it is followed by the first thing in it, which starts at `first`.
    fn transparent(&mut self, child: Option<Span>, first: Option<u32>) -> &mut Self {
        if self.following.is_none() && self.is_found && child.is_some() && first.is_some() {
            self.following = first;
        }
        self.one(child)
    }

    /// A list of children in source order. `is_open`: what follows the list follows its last
    /// element.
    fn list<'a, T: Handle<'a> + Spanned>(&mut self, list: List<'a, T>, is_open: bool) -> &mut Self {
        if self.following.is_some() {
            return self;
        }
        if self.is_found {
            self.following = list.first().map(|first| first.span().start);
            return self;
        }
        // A binary search for the first element that does not end before `me` does.
        let (mut low, mut high) = (0, list.len());
        while low < high {
            let middle = low + (high - low) / 2;
            match list.get(middle) {
                Some(it) if it.span().end < self.me.end => low = middle + 1,
                _ => high = middle,
            }
        }
        if list.get(low).is_some_and(|it| it.span().contains(self.me)) {
            self.is_found = true;
            self.following = match list.get(low + 1) {
                Some(next) => Some(next.span().start),
                None if is_open => None,
                None => Some(0),
            };
        }
        self
    }

    /// The same for what is not a [`List`].
    fn spans(&mut self, spans: impl Iterator<Item = Span>, is_open: bool) -> &mut Self {
        if self.following.is_some() {
            return self;
        }
        let was_found = self.is_found;
        for span in spans {
            if self.is_found {
                self.following = Some(span.start);
                return self;
            }
            self.is_found = span.contains(self.me);
        }
        if self.is_found && !was_found && !is_open {
            self.following = Some(0);
        }
        self
    }
}

fn key_span<'a>(key: Option<Key<'a>>, node: Node<'a>) -> Option<Span> {
    key.map(|key| key.span(node.file()))
}

/// The fields of everything that has parameters: type parameters, `this`, parameters, return type
/// and body.
fn function_fields(finder: &mut Finder, func: Func<'_>) {
    let first_parameter = func.params().first().map(|it| it.span().start);
    finder.one(func.type_params().angle_brackets_span()).one(func.this_param().map(|it| it.span()));
    // `this` is in the parentheses. If it is the only parameter, nothing follows it there.
    if finder.is_found && finder.following.is_none() && func.this_param().is_some_and(|it| it.span().contains(finder.me)) {
        finder.following = Some(first_parameter.unwrap_or(0));
    }
    finder
        .transparent(func.params_span(), first_parameter)
        .one(func.return_type().map(|it| it.annotation_span()))
        .one(match func.body() {
            FnBody::None => None,
            FnBody::Block(_) => func.body_span(),
            FnBody::Expr(e) => Some(e.span()),
        });
}

/// The function of a method, after its key. Babel, which Prettier parses JavaScript with, has no
/// node for it: the parameters are children of the method.
fn method_function(finder: &mut Finder, func: Func<'_>) {
    let first_parameter = func.params().first().filter(|it| it.file().is_javascript());
    finder.transparent(Some(func.estree_span()), first_parameter.map(|it| it.span().start));
}

fn member_fields(finder: &mut Finder, member: Member<'_>) {
    finder
        .spans(member.decorators().map(|it| AstNodes::Decorator(it).span()), false)
        .one(match member.constructor_keyword() {
            Some(keyword) => Some(keyword.span()),
            None => key_span(member.key(), Node::Member(member)),
        });
    match member.func() {
        // The `Function` of a method of a class is one child.
        Some(func) if matches!(func.as_ast_nodes(), AstNodes::Function(_)) => method_function(finder, func),
        Some(func) => function_fields(finder, func),
        None => {
            finder
                .one(member.ty().map(|it| it.annotation_span()))
                .one(member.init().map(|it| it.span()));
        }
    }
}

/// Where the next sibling of the child of `parent` at `span` starts, or 0 if there is none. The child
/// can be a name or something else that there is no [`AstNodes`] for.
pub(crate) fn following_span_start_in(mut span: Span, mut parent: AstNodes<'_>) -> u32 {
    loop {
        match following_span_start_among_siblings(span, parent) {
            Some(following) => return following,
            None => (span, parent) = (parent.span(), parent.parent()),
        }
    }
}

/// `None`: the child is the last one, and what follows `parent` follows it.
fn following_span_start_among_siblings(span: Span, parent: AstNodes<'_>) -> Option<u32> {
    use AstNodes as N;
    let mut finder = Finder {
        me: span,
        is_found: false,
        following: None,
    };
    let f = &mut finder;
    let span_of = |e: bun_lint::ast::Expr<'_>| Some(e.span());
    // Whether what follows the parent follows its last child.
    let mut inherits = true;

    match parent {
        N::Program(file) => {
            inherits = false;
            f.list(file.0.body(), false);
        }
        N::ArrayExpression(e) | N::ArrayAssignmentTarget(e) => {
            let is_target = matches!(parent, N::ArrayAssignmentTarget(_));
            inherits = !is_target;
            if let ExprKind::Array(elements) = e.kind() {
                f.spans(elements.iter().filter(|it| !it.is_missing()).map(|it| it.span()), is_target);
            }
        }
        N::ObjectExpression(e) | N::ObjectAssignmentTarget(e) => {
            let is_target = matches!(parent, N::ObjectAssignmentTarget(_));
            inherits = !is_target;
            if let ExprKind::Object(props) = e.kind() {
                f.list(props, is_target);
            }
        }
        N::ObjectProperty(prop)
        | N::AssignmentTargetPropertyIdentifier(prop)
        | N::AssignmentTargetPropertyProperty(prop)
        | N::JSXAttribute(prop) => {
            f.one(key_span(prop.key(), Node::Prop(prop)));
            match prop.func() {
                Some(func) => method_function(f, func),
                None => {
                    f.one(prop.value().map(|it| it.jsx_container_span().unwrap_or_else(|| it.span())));
                }
            }
        }
        N::TemplateLiteral(e) => {
            if let ExprKind::Template(template) = e.kind() {
                f.list(template.exprs(), false);
            }
        }
        N::TaggedTemplateExpression(e) | N::CallExpression(e) | N::NewExpression(e) => {
            if let ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) = e.kind() {
                f.one(span_of(call.callee()))
                    .one(call.type_args().angle_brackets_span())
                    .one(call.template().map(|it| it.span()));
                if call.template().is_none() {
                    f.list(call.args(), false);
                }
            }
        }
        N::ImportExpression(e) => {
            if let ExprKind::ImportCall { args } = e.kind() {
                f.list(args, true);
            }
        }
        N::StaticMemberExpression(e) | N::PrivateFieldExpression(e) | N::ComputedMemberExpression(e) => {
            match e.kind() {
                ExprKind::Dot { obj, name, .. } => f.one(span_of(obj)).one(Some(name.span())),
                ExprKind::Index { obj, index, .. } => f.one(span_of(obj)).one(span_of(index)),
                _ => f,
            };
        }
        N::BinaryExpression(e) | N::LogicalExpression(e) | N::PrivateInExpression(e) => {
            if let ExprKind::Binary { left, right, .. } = e.kind() {
                f.one(span_of(left)).one(span_of(right));
            }
        }
        N::SequenceExpression(e) => {
            f.spans(e.sequence().into_iter().map(|it| it.span()), false);
        }
        N::AssignmentExpression(e) | N::AssignmentTargetWithDefault(e) => {
            if let ExprKind::Assign { target, value, .. } = e.kind() {
                f.one(span_of(target)).one(span_of(value));
            }
        }
        N::ConditionalExpression(e) => {
            if let ExprKind::Cond { test, yes, no } = e.kind() {
                f.one(span_of(test)).one(span_of(yes)).one(span_of(no));
            }
        }
        N::TSAsExpression(e) | N::TSSatisfiesExpression(e) => match e.kind() {
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                f.one(span_of(expr)).one(Some(ty.span()));
            }
            ExprKind::AsConst(expr) => {
                f.one(span_of(expr)).one(e.const_keyword_span());
            }
            _ => {}
        },
        N::TSTypeAssertion(e) => match e.kind() {
            ExprKind::As { expr, ty } => {
                f.one(Some(ty.span())).one(span_of(expr));
            }
            ExprKind::AsConst(expr) => {
                f.one(e.const_keyword_span()).one(span_of(expr));
            }
            _ => {}
        },
        N::TSInstantiationExpression(e) => {
            if let ExprKind::Instantiation { expr, type_args } = e.kind() {
                f.one(span_of(expr)).one(type_args.angle_brackets_span());
            }
        }
        N::JSXElement(e) | N::JSXFragment(e) => {
            if let ExprKind::Jsx(jsx) = e.kind() {
                f.one(Some(jsx.opening_span()))
                    .spans(
                        jsx.children().iter().map(|it| it.jsx_container_span().unwrap_or_else(|| it.span())),
                        false,
                    )
                    .one(jsx.closing_span());
            }
        }
        N::JSXOpeningElement(e) => {
            if let ExprKind::Jsx(jsx) = e.kind() {
                // The `a` of `<a.b>` is followed by `b`.
                let mut name = jsx.tag();
                while let Some(ExprKind::Dot { obj, name: property, .. }) = name.map(|it| it.kind()) {
                    if obj.span() == span {
                        return Some(property.span().start);
                    }
                    name = Some(obj);
                }
                f.one(jsx.tag().map(|it| it.span()))
                    .one(jsx.type_args().angle_brackets_span())
                    .list(jsx.attrs(), false);
            }
        }

        N::Function(func) | N::ArrowFunctionExpression(func) => {
            f.one(func.name().map(|it| it.span()));
            function_fields(f, func);
        }
        N::FunctionBody(func) => {
            if let FnBody::Block(statements) = func.body() {
                f.list(statements, false);
            }
        }
        N::FormalParameters(func) => {
            inherits = false;
            f.list(func.params(), true);
        }
        N::FormalParameter(param) | N::FormalParameterRest(param) | N::TSThisParameter(param) => {
            f.spans(param.decorators().map(|it| N::Decorator(it).span()), false)
                .one(Some(param.pat().span()))
                .one(param.ty().map(|it| it.annotation_span()))
                .one(param.default().map(|it| it.span()));
        }
        N::Class(class) => {
            f.spans(class.decorators().map(|it| N::Decorator(it).span()), false)
                .one(class.name().map(|it| it.span()))
                .one(class.type_params().angle_brackets_span())
                .one(class.extends().map(|it| it.span()))
                .one(class.extends_args().angle_brackets_span())
                .list(class.implements(), false)
                .one(Some(class.body_span()));
        }
        N::ClassBody(class) => {
            f.list(class.members(), false);
        }
        N::MethodDefinition(member)
        | N::PropertyDefinition(member)
        | N::AccessorProperty(member)
        | N::TSIndexSignature(member)
        | N::TSPropertySignature(member)
        | N::TSMethodSignature(member)
        | N::TSCallSignatureDeclaration(member)
        | N::TSConstructSignatureDeclaration(member) => member_fields(f, member),
        N::StaticBlock(member) => {
            if let Some(FnBody::Block(statements)) = member.func().map(Func::body) {
                f.list(statements, false);
            }
        }

        N::VariableDeclarator(declaration) | N::CatchParameter(declaration) => {
            f.one(Some(declaration.pat().span()))
                .one(declaration.ty().map(|it| it.annotation_span()))
                .one(declaration.init().map(|it| it.span()));
        }
        N::ObjectPattern(pat) | N::ArrayPattern(pat) => {
            inherits = false;
            match pat.kind() {
                PatKind::Object(props) => f.list(props, true),
                PatKind::Array(elements) => {
                    f.spans(elements.iter().filter(|it| it.pat().is_some()).map(|it| it.span()), true)
                }
                _ => f,
            };
        }
        N::BindingProperty(prop) => {
            f.one(key_span(prop.key(), Node::PatProp(prop))).one(Some(match prop.default() {
                Some(default) => prop.value().span().to(default.span()),
                None => prop.value().span(),
            }));
        }
        N::AssignmentPattern(it) => {
            let (pat, default) = match it {
                Node::PatProp(prop) => (Some(prop.value()), prop.default()),
                Node::PatElem(element) => (element.pat(), element.default()),
                _ => (None, None),
            };
            f.one(pat.map(|it| it.span())).one(default.map(|it| it.span()));
        }

        N::SwitchCase(case) => {
            f.one(case.test().map(|it| it.span())).list(case.body(), false);
        }
        N::CatchClause(statement) => {
            if let StmtKind::Try { param, handler, .. } = statement.kind() {
                f.one(param.map(|it| it.span())).one(handler.map(|it| it.span()));
            }
        }
        N::TSModuleBlock(statement) => {
            if let StmtKind::Module(module) = statement.kind() {
                f.list(module.innermost().body(), false);
            }
        }
        N::TSInterfaceBody(statement) => {
            if let StmtKind::Interface(interface) = statement.kind() {
                f.list(interface.members(), false);
            }
        }
        N::TSEnumBody(statement) => {
            if let StmtKind::Enum(it) = statement.kind() {
                f.list(it.members(), false);
            }
        }
        N::TSEnumMember(member) => {
            f.one(key_span(member.key(), Node::EnumMember(member))).one(member.init().map(|it| it.span()));
        }
        N::ImportSpecifier(spec) => {
            f.one(Some(spec.imported().span())).one(Some(spec.local().span()));
        }
        N::ExportSpecifier(spec) => {
            f.one(Some(spec.local().span())).one(Some(spec.exported().span()));
        }

        N::ExpressionStatement(ExpressionStatement::ArrowBody(_)) => {}
        N::ExpressionStatement(ExpressionStatement::Stmt(_)) | N::Directive(_) => inherits = false,
        N::ExportNamedDeclaration(statement) | N::ExportDefaultDeclaration(statement) => {
            inherits = false;
            if let StmtKind::ExportNamed(export) = statement.kind() {
                f.list(export.items(), false).one(export.spec_span());
            }
        }
        N::BlockStatement(statement)
        | N::EmptyStatement(statement)
        | N::DebuggerStatement(statement)
        | N::VariableDeclaration(statement)
        | N::ReturnStatement(statement)
        | N::IfStatement(statement)
        | N::ForStatement(statement)
        | N::ForInStatement(statement)
        | N::ForOfStatement(statement)
        | N::WhileStatement(statement)
        | N::DoWhileStatement(statement)
        | N::WithStatement(statement)
        | N::SwitchStatement(statement)
        | N::TryStatement(statement)
        | N::ThrowStatement(statement)
        | N::BreakStatement(statement)
        | N::ContinueStatement(statement)
        | N::LabeledStatement(statement)
        | N::ImportDeclaration(statement)
        | N::ExportAllDeclaration(statement)
        | N::TSInterfaceDeclaration(statement)
        | N::TSTypeAliasDeclaration(statement)
        | N::TSEnumDeclaration(statement)
        | N::TSModuleDeclaration(statement)
        | N::TSGlobalDeclaration(statement)
        | N::TSImportEqualsDeclaration(statement)
        | N::TSExportAssignment(statement)
        | N::TSNamespaceExportDeclaration(statement) => {
            inherits = false;
            // What is in the head of a `for`: the declaration, or the expression.
            let head = |it: bun_lint::ast::Stmt<'_>| match it.kind() {
                StmtKind::Expr(e) => e.span(),
                _ => it.span(),
            };
            match statement.kind() {
                StmtKind::Block(statements) => {
                    f.list(statements, false);
                }
                StmtKind::Var(declarations) => {
                    f.list(declarations, false);
                }
                StmtKind::If { test, yes, no } => {
                    f.one(span_of(test)).one(Some(yes.span())).one(no.map(|it| it.span()));
                }
                StmtKind::For {
                    init,
                    test,
                    update,
                    body,
                } => {
                    f.one(init.map(head))
                        .one(test.map(|it| it.span()))
                        .one(update.map(|it| it.span()))
                        .one(Some(body.span()));
                }
                StmtKind::ForIn { left, expr, body } | StmtKind::ForOf { left, expr, body, .. } => {
                    f.one(Some(head(left))).one(span_of(expr)).one(Some(body.span()));
                }
                StmtKind::While { test, body } => {
                    f.one(span_of(test)).one(Some(body.span()));
                }
                StmtKind::DoWhile { body, test } => {
                    f.one(Some(body.span())).one(span_of(test));
                }
                StmtKind::With { object, body } => {
                    f.one(span_of(object)).one(Some(body.span()));
                }
                StmtKind::Switch { expr, cases } => {
                    f.one(span_of(expr)).list(cases, false);
                }
                StmtKind::Try {
                    block, finalizer, ..
                } => {
                    f.one(Some(block.span()))
                        .one(statement.catch_clause_span())
                        .one(finalizer.map(|it| it.span()));
                }
                StmtKind::Labeled { body, .. } => {
                    f.one(statement.label().map(|it| it.span())).one(Some(body.span()));
                }
                StmtKind::Import(import) => {
                    f.one(import.default().map(|it| it.span()))
                        .one(import.namespace_span())
                        .list(import.named(), false)
                        .one(import.spec_span());
                }
                StmtKind::Interface(interface) => {
                    f.one(Some(interface.name().span()))
                        .one(interface.type_params().angle_brackets_span())
                        .list(interface.extends(), false)
                        .one(Some(interface.body_span()));
                }
                StmtKind::TypeAlias(alias) => {
                    f.one(Some(alias.name().span()))
                        .one(alias.type_params().angle_brackets_span())
                        .one(Some(alias.ty().span()));
                }
                StmtKind::Enum(it) => {
                    f.one(Some(it.name().span())).one(Some(it.body_span()));
                }
                StmtKind::Module(module) => {
                    let name = match module.name() {
                        ModuleName::Ident(name) | ModuleName::String(name) => Some(name.span()),
                        ModuleName::Global => None,
                    };
                    f.one(name).one(module.innermost().body_span());
                }
                StmtKind::ImportEquals(import) => {
                    f.one(Some(import.name().span())).one(match import.target() {
                        ImportEqualsTarget::Require(_) => import.require_span(),
                        ImportEqualsTarget::Entity(name) => Some(name.span()),
                    });
                }
                _ => {}
            }
        }

        N::TSConditionalType(ty) => {
            if let TypeKind::Cond {
                check,
                extends,
                yes,
                no,
            } = ty.kind()
            {
                f.one(Some(check.span()))
                    .one(Some(extends.span()))
                    .one(Some(yes.span()))
                    .one(Some(no.span()));
            }
        }
        N::TSUnionType(ty) | N::TSIntersectionType(ty) | N::TSTemplateLiteralType(ty) => {
            if let TypeKind::Union(types) | TypeKind::Intersection(types) | TypeKind::Template(types) = ty.kind() {
                f.list(types, false);
            }
        }
        N::TSTupleType(ty) => {
            if let TypeKind::Tuple(elements) = ty.kind() {
                f.list(elements, false);
            }
        }
        N::TSNamedTupleMember(element) => {
            f.one(element.name().map(|it| it.span())).one(Some(element.ty().span()));
        }
        N::TSIndexedAccessType(ty) => {
            if let TypeKind::IndexedAccess { obj, index } = ty.kind() {
                f.one(Some(obj.span())).one(Some(index.span()));
            }
        }
        N::TSTypeReference(ty)
        | N::TSClassImplements(ty)
        | N::TSInterfaceHeritage(ty)
        | N::TSTypeQuery(ty)
        | N::TSImportType(ty) => {
            let name = match ty.kind() {
                TypeKind::Ref { name, .. } => Some(name.span()),
                TypeKind::Heritage { expr, .. } | TypeKind::Typeof { expr, .. } => Some(expr.span()),
                TypeKind::Import { .. } => ty.import_source_span(),
                _ => None,
            };
            f.one(name).one(type_arguments_of(Node::Type(ty)).and_then(|it| it.angle_brackets_span()));
        }
        N::TSTypeParameterInstantiation(owner) => {
            if let Some(arguments) = type_arguments_of(owner) {
                f.list(arguments, false);
            }
        }
        N::TSTypeParameterDeclaration(owner) => {
            if let Some(parameters) = type_parameters_of(owner) {
                f.list(parameters, false);
            }
        }
        N::TSTypeParameter(param) => {
            f.one(Some(param.name().span()))
                .one(param.constraint().map(|it| it.span()))
                .one(param.default().map(|it| it.span()));
        }
        N::TSTypeLiteral(ty) => {
            if let TypeKind::Object(members) = ty.kind() {
                f.list(members, false);
            }
        }
        N::TSFunctionType(ty) | N::TSConstructorType(ty) => {
            if let TypeKind::Fn(func) = ty.kind() {
                function_fields(f, func);
            }
        }
        N::TSMappedType(ty) => {
            if let TypeKind::Mapped(mapped) = ty.kind() {
                f.one(Some(mapped.param().name().span()))
                    .one(mapped.param().constraint().map(|it| it.span()))
                    .one(mapped.name_type().map(|it| it.span()))
                    .one(mapped.ty().map(|it| it.span()));
            }
        }
        N::TSTypePredicate(ty) => {
            if let TypeKind::Predicate { ty: asserted, .. } = ty.kind() {
                f.one(ty.predicate_param().map(|it| it.span())).one(asserted.map(|it| it.annotation_span()));
            }
        }
        // One child, or none.
        _ => {}
    }

    match finder.following {
        None if !inherits => Some(0),
        following => following,
    }
}
