use bun_lint::linter::GlobalVariable;
use bun_lint::prelude::*;
use bun_lint::source::ByName;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ast_utils::is_import_attribute_key;
use bun_lint::utils::{estree_span, estree_type_name, is_assignment_target, is_chain_root};
use rustc_hash::FxHashSet;

/// Require identifiers to match a specified regular expression.
pub struct IdMatch {
    pattern: String,
    /// `None` if the pattern is invalid.
    regex: Option<Regex>,
    checks_class_fields: bool,
    ignores_destructuring: bool,
    only_declarations: bool,
    checks_properties: bool,
}

const NOT_MATCH: Message = Message::new(
    "notMatch",
    "Identifier '{{name}}' does not match the pattern '{{pattern}}'.",
);
const NOT_MATCH_PRIVATE: Message = Message::new(
    "notMatchPrivate",
    "Identifier '#{{name}}' does not match the pattern '{{pattern}}'.",
);

#[derive(Default)]
pub struct State<'a> {
    /// Whether each name that has been seen fails to match.
    is_invalid: ByName<bool>,
    /// The key and the value of `{ a }` are two identifiers at the same place.
    reported: FxHashSet<Span>,
    /// `File::unresolved_references`, once a name in a type may be one of them.
    unresolved: Option<Vec<Reference<'a>>>,
    /// What is in an object pattern.
    object_patterns: AncestorMemo<'a, ()>,
}

/// ESTree's `key.name`: the name of a key that is an `Identifier`, in brackets or not.
fn key_identifier(key: Key<'_>) -> Option<Name<'_>> {
    match key.kind() {
        KeyKind::Ident(name) => Some(name),
        KeyKind::Computed(e) => e.as_ident(),
        _ => None,
    }
}

/// ESLint's `isInsideObjectPattern`.
fn is_inside_object_pattern<'a>(node: Node<'a>, state: &mut State<'a>) -> bool {
    let is_object_pattern = |it: Node<'a>| match it {
        Node::Pat(pat) => pat.tag() == PatTag::Object,
        Node::Expr(e) => e.tag() == ExprTag::Object && is_assignment_target(e),
        _ => false,
    };
    state.object_patterns.find(node, |_, it| is_object_pattern(it).then_some(())).is_some()
}

/// Whether `member`, an `a.b` or an `a[b]`, is a side of an assignment expression that assigns to a
/// property named `name`.
fn is_in_assignment_to_property(member: Expr<'_>, name: &[u8]) -> bool {
    if is_chain_root(member) {
        return false;
    }
    let Node::Expr(parent) = member.parent() else {
        return false;
    };
    let ExprKind::Assign { op, target, .. } = parent.kind() else {
        return false;
    };
    if op.is_none() && is_assignment_target(parent) {
        return false;
    }
    match target.kind() {
        ExprKind::Dot { name: property, .. } => {
            let property = property.bytes();
            property.strip_prefix(b"#").unwrap_or(property) == name
        }
        ExprKind::Index { index, .. } => index.as_ident().is_some_and(|it| it.bytes() == name),
        _ => false,
    }
}

/// `node.type === "PropertyDefinition"`
fn is_property_definition(member: Member<'_>) -> bool {
    member.kind() == MemberKind::Property
        && !member.is_signature()
        && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
}

/// Whether `reference`, which nothing in the file declares, resolves to `global`.
fn resolves_to(reference: Reference<'_>, global: &GlobalVariable<'_>) -> bool {
    reference.symbol().is_none()
        && (!global.is_only_in_lib
            || (reference.is_value() && global.is_value)
            || (reference.is_type() && global.is_type))
}

/// ESLint's `isReferenceToGlobalVariable`: the user has no control over the name.
fn is_reference_to_global_variable(e: Expr<'_>) -> bool {
    let Some(global) = e.as_ident().and_then(|name| e.file().global(name.bytes())) else {
        return false;
    };
    e.reference().is_some_and(|it| resolves_to(it, &global))
}

impl IdMatch {
    fn fails(&self, name: &[u8]) -> bool {
        // The default.
        if self.pattern == "^.+$" {
            return name.is_empty() || text::has_line_break(name);
        }
        self.regex.as_ref().is_some_and(|regex| !regex.test(name))
    }

    /// ESLint's `isInvalid`. A private name is tested without its `#`.
    fn is_invalid<'a>(&self, name: Name<'a>, cx: &mut Cx<'a, Self>) -> bool {
        cx.state.is_invalid.get_or_insert_with(name, || {
            let text = name.bytes();
            self.fails(text.strip_prefix(b"#").unwrap_or(text))
        })
    }

    fn report<'a>(&self, at: Span, name: &'a [u8], cx: &mut Cx<'a, Self>) {
        if !cx.state.reported.insert(at) {
            return;
        }
        let (message, name) = match name {
            [b'#', rest @ ..] => (NOT_MATCH_PRIVATE, rest),
            _ => (NOT_MATCH, name),
        };
        cx.report(at, message).data("name", name).data("pattern", self.pattern.clone());
    }

    /// An `Identifier` that is reported whatever is around it.
    fn check_name<'a>(&self, name: Ident<'a>, cx: &mut Cx<'a, Self>) {
        if !name.is_string() && self.is_invalid(name.name(), cx) {
            self.report(name.span(), name.bytes(), cx);
        }
    }

    /// The same for a name that is a reference and not an expression: in a type, in an export.
    // TODO(api): replace the search by semantic::File::reference_at(offset)
    fn check_referencing_name<'a>(&self, name: Ident<'a>, cx: &mut Cx<'a, Self>) {
        if name.is_string() || !self.is_invalid(name.name(), cx) {
            return;
        }
        let file = cx.file();
        if let Some(global) = file.global(name.bytes()) {
            let unresolved =
                cx.state.unresolved.get_or_insert_with(|| file.unresolved_references().collect());
            let first = unresolved.partition_point(|it| it.ident().start() < name.start());
            let rest = unresolved.get(first..).unwrap_or_default().iter();
            let mut here = rest.take_while(|it| it.ident().start() == name.start());
            if here.any(|it| resolves_to(*it, &global)) {
                return;
            }
        }
        self.report(name.span(), name.bytes(), cx);
    }

    /// A key that is an `Identifier` or a `PrivateIdentifier`.
    fn check_key<'a>(&self, key: Key<'a>, cx: &mut Cx<'a, Self>) {
        if let KeyKind::Ident(name) | KeyKind::Private(name) = key.kind()
            && self.is_invalid(name, cx)
        {
            self.report(key.span(cx.file()), name.bytes(), cx);
        }
    }

    /// Whether the `left` of an `AssignmentPattern` is checked.
    fn checks_target_with_default<'a>(&self, target: Node<'a>, state: &mut State<'a>) -> bool {
        self.checks_properties
            && !self.only_declarations
            && !(self.ignores_destructuring && is_inside_object_pattern(target, state))
    }

    /// Whether `e`, named `name`, is checked as the computed key or the value of `prop`.
    fn checks_in_property<'a>(&self, prop: Prop<'a>, e: Expr<'a>, name: Name<'a>, state: &mut State<'a>) -> bool {
        let (Node::Expr(object), Some(key)) = (prop.parent(), prop.key()) else {
            return !self.only_declarations;
        };
        if prop.is_jsx_attribute() {
            return !self.only_declarations;
        }
        if is_assignment_target(object) {
            let key_equals_value = key_identifier(key) == Some(name)
                && prop.value().and_then(Expr::as_ident) == Some(name);
            return match prop.value() == Some(e) {
                true => !(key_equals_value && self.ignores_destructuring),
                false => key_equals_value && !self.ignores_destructuring,
            };
        }
        // The key of `{ a }` is at the same place, and `check_property` reports it.
        prop.kind() != PropKind::Shorthand
            && (self.checks_properties || key.is_computed())
            && !self.only_declarations
            && !(self.ignores_destructuring && is_inside_object_pattern(e.into(), state))
    }

    /// Whether the identifier `e`, named `name`, is checked where it is.
    fn checks_reference<'a>(&self, e: Expr<'a>, name: Name<'a>, state: &mut State<'a>) -> bool {
        match e.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot { .. } if e.is_in_type_query() => !self.only_declarations,
                ExprKind::Dot { .. } => self.checks_properties,
                ExprKind::Index { obj, .. } => {
                    self.checks_properties
                        && (obj.as_ident() == Some(name)
                            || is_in_assignment_to_property(parent, name.bytes()))
                }
                ExprKind::Call(_) | ExprKind::New(_) => false,
                ExprKind::Assign { op: None, target, .. } if is_assignment_target(parent) => {
                    target == e && self.checks_target_with_default(e.into(), state)
                }
                _ => !self.only_declarations,
            },
            Node::Prop(prop) => self.checks_in_property(prop, e, name, state),
            // A default value, or a computed key.
            Node::PatProp(prop) => {
                prop.default().is_none()
                    && prop.value().as_ident() == Some(name)
                    && !self.ignores_destructuring
            }
            Node::PatElem(_) => false,
            Node::Param(param) => param.default() != Some(e) && !self.only_declarations,
            Node::VarDecl(_) => true,
            Node::Member(member)
                if is_property_definition(member) && !member.decorators().any(|it| it == e) =>
            {
                self.checks_class_fields
            }
            _ => !self.only_declarations,
        }
    }

    fn check_reference<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = e.as_ident()
            && self.is_invalid(name, cx)
            && self.checks_reference(e, name, &mut cx.state)
            && !e.is_jsx_tag_name()
            && !is_reference_to_global_variable(e)
        {
            self.report(e.span(), name.bytes(), cx);
        }
    }

    /// The `b` of `a.b`.
    fn check_property_name<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { obj, name, .. } = e.kind() else {
            return;
        };
        let is_private = name.bytes().starts_with(b"#");
        if !is_private
            && !self.checks_properties
            && (self.only_declarations || e.file().is_javascript())
        {
            return;
        }
        if !self.is_invalid(name.name(), cx) {
            return;
        }
        let is_checked = is_private
            || !e.is_jsx_tag_name()
                && match e.is_in_type_query() {
                    true => !self.only_declarations,
                    false => {
                        self.checks_properties
                            && (obj.as_ident() == Some(name.name())
                                || is_in_assignment_to_property(e, name.bytes()))
                    }
                };
        if is_checked {
            self.report(name.span(), name.bytes(), cx);
        }
    }

    fn check_binding<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = pat.as_ident() else {
            return;
        };
        if !self.is_invalid(name, cx) {
            return;
        }
        let is_checked = match pat.parent() {
            Node::VarDecl(declaration) => {
                !self.only_declarations
                    || !matches!(declaration.parent(), Node::Stmt(it) if it.tag() == StmtTag::Try)
            }
            Node::Param(param) if param.default().is_some() => {
                self.checks_target_with_default(pat.into(), &mut cx.state)
            }
            Node::Param(param) => {
                !self.only_declarations
                    || (!param.is_rest()
                        && !param.is_parameter_property()
                        && param.func().is_some_and(|it| it.kind() == FnKind::Decl && it.has_body()))
            }
            Node::PatElem(element) if element.default().is_some() => {
                self.checks_target_with_default(pat.into(), &mut cx.state)
            }
            Node::PatProp(prop) if prop.is_rest() => !self.only_declarations,
            Node::PatProp(prop) if prop.default().is_some() => {
                self.checks_target_with_default(pat.into(), &mut cx.state)
            }
            Node::PatProp(prop) => {
                !(self.ignores_destructuring && prop.key().and_then(key_identifier) == Some(name))
            }
            _ => !self.only_declarations,
        };
        if is_checked {
            self.report(estree_span(pat.into()), name.bytes(), cx);
        }
    }

    /// The keys of an object pattern in a declaration. That of `{ a }` is at the same place as the
    /// value.
    fn check_keys_of_pattern<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(props) = pat.kind() else {
            return;
        };
        for prop in props {
            if let Some(key) = prop.key()
                && let KeyKind::Ident(name) = key.kind()
                && match prop.default() {
                    Some(_) => prop.is_shorthand(),
                    None => !prop.is_shorthand() && prop.value().as_ident() == Some(name),
                }
            {
                self.check_key(key, cx);
            }
        }
    }

    /// The key of a property of an object literal, which can be a pattern in an assignment.
    fn check_property<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let Some(key) = prop.key() else {
            return;
        };
        let KeyKind::Ident(name) = key.kind() else {
            return;
        };
        if prop.is_jsx_attribute() || !self.is_invalid(name, cx) {
            return;
        }
        let Node::Expr(object) = prop.parent() else {
            return;
        };
        let is_checked = match is_assignment_target(object) {
            true => {
                !self.ignores_destructuring
                    && match prop.value().map(Expr::kind) {
                        Some(ExprKind::Ident(value)) => value == name,
                        Some(ExprKind::Assign { op: None, .. }) => prop.kind() == PropKind::Shorthand,
                        _ => false,
                    }
            }
            false => self.checks_properties && !is_import_attribute_key(prop),
        };
        if is_checked {
            self.check_key(key, cx);
        }
    }

    fn check_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let Some(key) = member.key() else {
            if !self.only_declarations
                && let Some(keyword) = member.constructor_keyword()
            {
                self.check_name(keyword, cx);
            }
            return;
        };
        let is_checked = match is_property_definition(member) {
            true => self.checks_class_fields,
            false => key.is_private() || !self.only_declarations,
        };
        if is_checked {
            self.check_key(key, cx);
        }
    }

    /// The names in statements that are reported unless only declarations are.
    fn check_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            StmtKind::Labeled { .. } | StmtKind::Break(_) | StmtKind::Continue(_) => {
                if let Some(label) = statement.label() {
                    self.check_name(label, cx);
                }
            }
            StmtKind::ExportStar { alias: Some(alias), .. } => self.check_name(alias, cx),
            StmtKind::Interface(it) => self.check_name(it.name(), cx),
            StmtKind::TypeAlias(it) => self.check_name(it.name(), cx),
            StmtKind::Enum(it) => self.check_name(it.name(), cx),
            StmtKind::Module(it) => match it.name() {
                ModuleName::Ident(name) => self.check_name(name, cx),
                ModuleName::String(_) => {}
                ModuleName::Global => {
                    if self.fails(b"global") {
                        self.report(it.name_span(), b"global", cx);
                    }
                }
            },
            StmtKind::ImportEquals(it) => {
                self.check_name(it.name(), cx);
                if let ImportEqualsTarget::Entity(name) = it.target() {
                    self.check_entity_name(name, cx);
                }
            }
            StmtKind::ExportAsNamespace(_) => {
                if let Some(name) = statement.namespace_export_name() {
                    self.check_name(name, cx);
                }
            }
            _ => {}
        }
    }

    /// `a.b.c` where ESLint has `TSQualifiedName`s.
    fn check_entity_name<'a>(&self, name: EntityName<'a>, cx: &mut Cx<'a, Self>) {
        for (i, part) in name.parts().enumerate() {
            match i {
                0 => self.check_referencing_name(part, cx),
                _ => self.check_name(part, cx),
            }
        }
    }

    fn check_type<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        match ty.kind() {
            // The `a.b` of `extends a.b` and `implements a.b` is a `MemberExpression`.
            TypeKind::Ref { name, .. }
                if name.len() > 1 && estree_type_name(ty.into()) != "TSTypeReference" =>
            {
                if !self.checks_properties {
                    return;
                }
                if let (Some(object), Some(property)) = (name.get(0), name.get(1)) {
                    self.check_referencing_name(object, cx);
                    if object.name() == property.name() {
                        self.check_name(property, cx);
                    }
                }
            }
            _ if self.only_declarations => {}
            TypeKind::Ref { name, .. } => self.check_entity_name(name, cx),
            TypeKind::Import { name, .. } => {
                for part in name.parts() {
                    self.check_name(part, cx);
                }
            }
            TypeKind::Predicate { .. } => {
                if let Some(param) = ty.predicate_param()
                    && !param.name().is("this")
                {
                    self.check_name(param, cx);
                }
            }
            TypeKind::Tuple(elements) => {
                for name in elements.iter().filter_map(TupleElem::name) {
                    self.check_name(name, cx);
                }
            }
            _ => {}
        }
    }
}

impl Rule for IdMatch {
    const META: Meta = Meta::eslint("id-match", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let pattern = options.str(0).unwrap_or("^.+$");
        let object = options.object(1);
        IdMatch {
            pattern: pattern.to_owned(),
            regex: Regex::new(pattern, "u").ok(),
            checks_class_fields: object.bool_or("classFields", false),
            ignores_destructuring: object.bool_or("ignoreDestructuring", false),
            only_declarations: object.bool_or("onlyDeclarations", false),
            checks_properties: object.bool_or("properties", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if self.regex.is_none() {
            return State::default();
        }
        on.exprs([ExprTag::Ident], Self::check_reference);
        on.exprs([ExprTag::Dot], Self::check_property_name);
        on.exprs([ExprTag::PrivateIdentifier], |rule, e, cx| {
            if let ExprKind::PrivateIdentifier(name) = e.kind()
                && rule.is_invalid(name, cx)
            {
                rule.report(e.span(), name.bytes(), cx);
            }
        });
        on.pats([PatTag::Ident], Self::check_binding);
        if !self.ignores_destructuring {
            on.pats([PatTag::Object], Self::check_keys_of_pattern);
        }
        if self.checks_properties || !self.ignores_destructuring {
            on.props(Self::check_property);
        }
        on.members(Self::check_member);
        on.funcs(|rule, func, cx| {
            if let Some(name) = func.name()
                && (!rule.only_declarations || (func.kind() == FnKind::Decl && func.has_body()))
            {
                rule.check_name(name, cx);
            }
        });
        on.stmts([StmtTag::Import], |rule, statement, cx| {
            if let StmtKind::Import(import) = statement.kind() {
                for name in [import.default(), import.namespace()].into_iter().flatten() {
                    rule.check_name(name, cx);
                }
            }
        });
        on.import_specs(|rule, specifier, cx| {
            let (imported, local) = (specifier.imported(), specifier.local());
            rule.check_name(local, cx);
            if specifier.is_renamed() && imported.name() == local.name() {
                rule.check_name(imported, cx);
            }
        });
        let is_typescript = !file.is_javascript();
        if is_typescript && (self.checks_properties || !self.only_declarations) {
            on.types(
                [TypeTag::Ref, TypeTag::Import, TypeTag::Predicate, TypeTag::Tuple],
                Self::check_type,
            );
        }
        if self.only_declarations {
            return State::default();
        }
        on.classes(|rule, class, cx| {
            if let Some(name) = class.name() {
                rule.check_name(name, cx);
            }
        });
        on.stmts(
            [StmtTag::Labeled, StmtTag::Break, StmtTag::Continue, StmtTag::ExportStar],
            Self::check_statement,
        );
        on.export_specs(|rule, specifier, cx| {
            match specifier.export().has_from() {
                true => rule.check_name(specifier.local(), cx),
                false => rule.check_referencing_name(specifier.local(), cx),
            }
            if specifier.is_renamed() {
                rule.check_name(specifier.exported(), cx);
            }
        });
        if is_typescript {
            on.stmts(
                [
                    StmtTag::Interface,
                    StmtTag::TypeAlias,
                    StmtTag::Enum,
                    StmtTag::Module,
                    StmtTag::ImportEquals,
                    StmtTag::ExportAsNamespace,
                ],
                Self::check_statement,
            );
            on.type_params(|rule, param, cx| rule.check_name(param.name(), cx));
            on.enum_members(|rule, member, cx| {
                if let Some(key) = member.key() {
                    rule.check_key(key, cx);
                }
            });
        }
        State::default()
    }
}
