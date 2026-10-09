use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashSet;

/// Disallow dangling underscores in identifiers.
pub struct NoUnderscoreDangle {
    allow: Vec<Box<[u8]>>,
    allow_after_super: bool,
    allow_after_this: bool,
    allow_after_this_constructor: bool,
    allow_function_params: bool,
    allow_in_array_destructuring: bool,
    allow_in_object_destructuring: bool,
    /// An option of oxlint alone.
    allow_in_using_declarations: bool,
    enforce_in_class_fields: bool,
    enforce_in_method_names: bool,
}

const UNEXPECTED_UNDERSCORE: Message = Message::new(
    "unexpectedUnderscore",
    "Unexpected dangling '_' in '{{identifier}}'.",
);

fn has_dangling_underscore(identifier: &[u8]) -> bool {
    identifier != b"_" && (identifier.starts_with(b"_") || identifier.ends_with(b"_"))
}

/// ESTree's `object` and `property.name` of a `MemberExpression`. In `a[b]` the name is `b`.
fn object_and_property_name(e: Expr<'_>) -> Option<(Expr<'_>, &[u8])> {
    match e.kind() {
        ExprKind::Dot { obj, name, .. } => Some((obj, strings::without_prefix(name.bytes(), b"#"))),
        ExprKind::Index { obj, index, .. } => Some((obj, index.as_ident()?.bytes())),
        _ => None,
    }
}

/// Whether ESTree has a `MemberExpression` for the member access `e`, and not a
/// `JSXMemberExpression` or a `TSQualifiedName`.
fn is_member_expression<'a>(e: Expr<'a>, known: &mut AncestorMemo<'a, bool>) -> bool {
    let found = known.find(Node::Expr(e), |at, parent| match parent {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Dot { obj, .. } if Node::Expr(obj) == at => None,
            ExprKind::Jsx(jsx) => {
                Some(jsx.tag().map(Node::Expr) != Some(at) && jsx.close_tag().map(Node::Expr) != Some(at))
            }
            _ => Some(true),
        },
        Node::Type(_) => Some(false),
        _ => Some(true),
    });
    found != Some(false)
}

fn is_this_constructor_reference(object: Expr<'_>) -> bool {
    !utils::is_chain_root(object)
        && matches!(
            object_and_property_name(object),
            Some((inner, b"constructor")) if inner.tag() == ExprTag::This
        )
}

impl NoUnderscoreDangle {
    fn is_allowed(&self, identifier: &[u8]) -> bool {
        self.allow.iter().any(|it| **it == *identifier)
    }

    fn is_unexpected(&self, identifier: &[u8]) -> bool {
        has_dangling_underscore(identifier) && !self.is_allowed(identifier)
    }

    fn check_function_declaration<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Fn(func) = statement.kind()
            && let Some(name) = func.name()
            && self.is_unexpected(name.bytes())
            && (func.has_body() || cx.language().is_oxlint)
        {
            // Here and below, oxlint points at the name.
            let place = if cx.language().is_oxlint { name.span() } else { statement.span_without_export() };
            cx.report(place, UNEXPECTED_UNDERSCORE).data("identifier", name);
        }
    }

    fn check_param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = param.pat().as_ident()
            && self.is_unexpected(name.bytes())
            && !param.is_parameter_property()
            && param.func().is_some_and(ast_utils::is_function_with_body)
        {
            let place = if cx.language().is_oxlint { param.pat().span() } else { param.span_without_modifiers() };
            cx.report(place, UNEXPECTED_UNDERSCORE).data("identifier", name);
        }
    }

    fn check_variable<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let is_declarator =
            || matches!(declaration.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Var);
        let pat = declaration.pat();
        if let PatKind::Ident(name) = pat.kind() {
            let is_using = matches!(declaration.var_kind(), VarKind::Using | VarKind::AwaitUsing);
            if self.is_unexpected(name.bytes()) && is_declarator() && !(is_using && self.allow_in_using_declarations) {
                let place = if cx.language().is_oxlint { pat.span() } else { declaration.span() };
                cx.report(place, UNEXPECTED_UNDERSCORE).data("identifier", name);
            }
            return;
        }
        if self.allow_in_array_destructuring && self.allow_in_object_destructuring || !is_declarator() {
            return;
        }
        // A name that is bound twice is one variable, which goes by its first binding.
        let mut seen: FxHashSet<Name<'a>> = FxHashSet::default();
        pat.for_each_binding(&mut |binding| {
            let Some(name) = binding.as_ident() else {
                return;
            };
            if !has_dangling_underscore(name.bytes()) || !seen.insert(name) {
                return;
            }
            let is_allowed_here = match binding.parent() {
                Node::PatElem(_) => self.allow_in_array_destructuring,
                Node::PatProp(_) => self.allow_in_object_destructuring,
                _ => false,
            };
            if !is_allowed_here && !self.is_allowed(name.bytes()) {
                let place = if cx.language().is_oxlint { binding.span() } else { declaration.span() };
                cx.report(place, UNEXPECTED_UNDERSCORE).data("identifier", name);
            }
        });
    }

    fn check_member_expression<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some((object, identifier)) = object_and_property_name(e) else {
            return;
        };
        if !has_dangling_underscore(identifier)
            || self.allow_after_this && object.tag() == ExprTag::This
            || self.allow_after_super && object.tag() == ExprTag::Super
            || self.allow_after_this_constructor && is_this_constructor_reference(object)
            || identifier == b"__proto__"
            || self.is_allowed(identifier)
            || !is_member_expression(e, &mut cx.state)
        {
            return;
        }
        let place = match e.kind() {
            ExprKind::Dot { name, .. } if cx.language().is_oxlint => name.span(),
            // It says nothing about `a[_b]`.
            ExprKind::Index { .. } if cx.language().is_oxlint => return,
            _ => e.span(),
        };
        cx.report(place, UNEXPECTED_UNDERSCORE).data("identifier", identifier);
    }

    /// `A.b` after `implements`, or after the `extends` of an interface, is a `MemberExpression`
    /// in ESTree.
    fn check_heritage<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Ref { name, .. } = ty.kind() else {
            return;
        };
        let is_unexpected = |part: &Ident<'a>| self.is_unexpected(part.bytes()) && part.bytes() != b"__proto__";
        if name.len() < 2 || !name.parts().skip(1).any(|part| is_unexpected(&part)) {
            return;
        }
        let is_heritage = match ty.parent() {
            Node::Class(class) => class.implements().around(ty.span().start) == Some(ty),
            Node::Stmt(statement) => statement.tag() == StmtTag::Interface,
            _ => false,
        };
        let Some(first) = name.first().filter(|_| is_heritage) else {
            return;
        };
        for part in name.parts().skip(1).filter(is_unexpected) {
            cx.report(first.span().to(part.span()), UNEXPECTED_UNDERSCORE).data("identifier", part);
        }
    }

    /// `at`: the method or the class field with the name `key`.
    fn check_key<'a>(&self, key: Key<'a>, at: Span, cx: &mut Cx<'a, Self>) {
        // ESTree's `key.name`. In `[a]() {}` it is `a`.
        let name = match key.kind() {
            KeyKind::Ident(name) | KeyKind::Private(name) => name,
            KeyKind::Computed(e) => match e.as_ident() {
                Some(name) => name,
                None => return,
            },
            _ => return,
        };
        if self.is_unexpected(strings::without_prefix(name.bytes(), b"#")) {
            // oxlint has the name without the `#`.
            match cx.language().is_oxlint {
                true => cx
                    .report(key.inner_span(cx.file()), UNEXPECTED_UNDERSCORE)
                    .data("identifier", strings::without_prefix(name.bytes(), b"#")),
                false => cx.report(at, UNEXPECTED_UNDERSCORE).data("identifier", name),
            };
        }
    }

    fn check_class_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let is_enforced = match member.kind() {
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter => self.enforce_in_method_names,
            MemberKind::Property => {
                self.enforce_in_class_fields && !member.flags().contains(Flags::ACCESSOR)
            }
            _ => false,
        };
        if is_enforced
            && !member.flags().contains(Flags::ABSTRACT)
            && !member.is_signature()
            && let Some(key) = member.key()
        {
            self.check_key(key, member.span(), cx);
        }
    }

    fn check_property<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.kind() == PropKind::Method
            && let Some(key) = prop.key()
        {
            self.check_key(key, prop.span(), cx);
        }
    }
}

impl Rule for NoUnderscoreDangle {
    const META: Meta = Meta::eslint("no-underscore-dangle", Kind::Suggestion);
    /// `is_member_expression`
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUnderscoreDangle {
            allow: options.strings("allow").into_iter().map(|it| it.as_bytes().into()).collect(),
            allow_after_super: options.bool_or("allowAfterSuper", false),
            allow_after_this: options.bool_or("allowAfterThis", false),
            allow_after_this_constructor: options.bool_or("allowAfterThisConstructor", false),
            allow_function_params: options.bool_or("allowFunctionParams", true),
            allow_in_array_destructuring: options.bool_or("allowInArrayDestructuring", true),
            allow_in_object_destructuring: options.bool_or("allowInObjectDestructuring", true),
            allow_in_using_declarations: options.bool_or("allowInUsingDeclarations", false),
            enforce_in_class_fields: options.bool_or("enforceInClassFields", false),
            enforce_in_method_names: options.bool_or("enforceInMethodNames", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        on.stmts([StmtTag::Fn], Self::check_function_declaration);
        on.var_decls(Self::check_variable);
        on.exprs([ExprTag::Dot, ExprTag::Index], Self::check_member_expression);
        if !file.is_javascript() {
            on.types([TypeTag::Ref], Self::check_heritage);
        }
        if !self.allow_function_params {
            on.params(Self::check_param);
        }
        if self.enforce_in_method_names || self.enforce_in_class_fields {
            on.members(Self::check_class_member);
        }
        if self.enforce_in_method_names {
            on.props(Self::check_property);
        }
        AncestorMemo::default()
    }
}
