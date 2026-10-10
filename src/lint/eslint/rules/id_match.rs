use bun_core::strings;
use super::id_length::key_identifier;
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
    // oxlint looks only at what is assigned to.
    if member.file().language().is_oxlint {
        return target == member;
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
    // For oxlint an abstract field and an `accessor` are fields like the others.
    let others = match member.file().language().is_oxlint {
        true => Flags::empty(),
        false => Flags::ABSTRACT | Flags::ACCESSOR,
    };
    member.kind() == MemberKind::Property && !member.is_signature() && !member.flags().intersects(others)
}

/// Whether the key `name` of `prop`, a property of `object`, is left alone as the key of an import attribute. In the
/// options of an `import()` those are for oxlint only `with`, and the keys of the object that is its value.
fn is_key_of_import_attribute<'a>(prop: Prop<'a>, name: Name<'a>, object: Expr<'a>) -> bool {
    let is_key = is_import_attribute_key(prop);
    if !is_key || !prop.file().language().is_oxlint {
        return is_key;
    }
    let is_options = |it: Expr<'a>| matches!(it.parent(), Node::Expr(parent) if parent.tag() == ExprTag::ImportCall);
    match object.parent() {
        Node::Prop(outer) => {
            matches!(outer.key().map(Key::kind), Some(KeyKind::Ident(it) | KeyKind::String(it)) if it.is("with"))
                && matches!(outer.parent(), Node::Expr(options) if is_options(options))
        }
        _ => !is_options(object) || name.is("with"),
    }
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
            return name.is_empty() || strings::contains_js_line_break(name);
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
            // oxlint checks a computed key there as it does elsewhere.
            if e.file().language().is_oxlint && matches!(key.kind(), KeyKind::Computed(it) if it == e) {
                return !self.only_declarations;
            }
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
        // oxlint sees through what only concerns types: `a as T`, `a!`.
        let is_oxlint = e.file().language().is_oxlint;
        let mut e = e;
        while is_oxlint
            && let Node::Expr(parent) = e.parent()
            && matches!(
                parent.tag(),
                ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull | ExprTag::Instantiation
            )
        {
            e = parent;
        }
        match e.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot { .. } if e.is_in_type_query() => !self.only_declarations,
                ExprKind::Dot { .. } => self.checks_properties,
                ExprKind::Index { obj, .. } => {
                    self.checks_properties
                        && (obj.as_ident() == Some(name)
                            || is_oxlint && obj == e
                            || is_in_assignment_to_property(parent, name.bytes()))
                }
                ExprKind::Call(_) | ExprKind::New(_) => false,
                ExprKind::Assign { op: None, target, .. } if is_assignment_target(parent) => {
                    target == e && self.checks_target_with_default(e.into(), state)
                }
                _ => !self.only_declarations,
            },
            Node::Prop(prop) => self.checks_in_property(prop, e, name, state),
            // oxlint checks a computed key there as it does elsewhere.
            Node::PatProp(prop)
                if is_oxlint && matches!(prop.key().map(Key::kind), Some(KeyKind::Computed(key)) if key == e) =>
            {
                !self.only_declarations
            }
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
            && (self.only_declarations || e.file().is_javascript() && !e.is_in_type_query())
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
            // For oxlint the parameter of an index signature has no name.
            Node::Param(param)
                if cx.language().is_oxlint && param.func().is_some_and(|it| it.kind() == FnKind::IndexSignature) =>
            {
                false
            }
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
            // For oxlint the type annotation is not part of it.
            let place = if cx.language().is_oxlint { pat.span() } else { estree_span(pat.into()) };
            self.report(place, name.bytes(), cx);
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
            false => self.checks_properties && !is_key_of_import_attribute(prop, name, object),
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
                ModuleName::Ident(_) => {
                    let names = std::iter::successors(Some(it), |it| it.nested());
                    for name in names.map(Module::name) {
                        if let ModuleName::Ident(name) = name {
                            self.check_name(name, cx);
                        }
                    }
                }
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

    /// The keys of `{ with: { key: "" } }` in `import("m", { with: { key: "" } })`, which ESLint has
    /// as an object literal.
    fn check_options_of_import_type<'a>(&self, attributes: ImportAttributes<'a>, cx: &mut Cx<'a, Self>) {
        let keyword = attributes.keyword_span();
        let name = cx.file().slice(keyword);
        if self.fails(name) {
            self.report(keyword, name, cx);
        }
        for key in attributes.entries().iter().filter_map(Prop::key) {
            self.check_key(key, cx);
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
            TypeKind::Import { name, .. } => {
                if self.checks_properties
                    && let Some(attributes) = ty.import_attributes()
                {
                    self.check_options_of_import_type(attributes, cx);
                }
                if !self.only_declarations {
                    for part in name.parts() {
                        self.check_name(part, cx);
                    }
                }
            }
            _ if self.only_declarations => {}
            TypeKind::Ref { name, .. } => self.check_entity_name(name, cx),
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
    const ON: On = On::new()
        .exprs(&[ExprTag::Ident, ExprTag::Dot, ExprTag::PrivateIdentifier])
        .pats(&[PatTag::Ident, PatTag::Object])
        .props()
        .members()
        .funcs()
        .stmts(&[
            StmtTag::Import,
            StmtTag::Labeled,
            StmtTag::Break,
            StmtTag::Continue,
            StmtTag::ExportStar,
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::ImportEquals,
            StmtTag::ExportAsNamespace,
        ])
        .import_specs()
        .types(&[
            TypeTag::Ref,
            TypeTag::Import,
            TypeTag::Predicate,
            TypeTag::Tuple,
        ])
        .classes()
        .export_specs()
        .type_params()
        .enum_members();
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

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new()
            .exprs(&[ExprTag::Ident, ExprTag::Dot, ExprTag::PrivateIdentifier])
            .pats(&[PatTag::Ident])
            .members()
            .funcs()
            .stmts(&[StmtTag::Import])
            .import_specs();
        if !self.ignores_destructuring {
            on = on.pats(&[PatTag::Object]);
        }
        if self.checks_properties || !self.ignores_destructuring {
            on = on.props();
        }
        if self.checks_properties || !self.only_declarations {
            on = on.types(&[TypeTag::Ref, TypeTag::Import, TypeTag::Predicate, TypeTag::Tuple]);
        }
        if self.only_declarations {
            return on;
        }
        on.classes()
            .stmts(&[
                StmtTag::Labeled,
                StmtTag::Break,
                StmtTag::Continue,
                StmtTag::ExportStar,
                StmtTag::Interface,
                StmtTag::TypeAlias,
                StmtTag::Enum,
                StmtTag::Module,
                StmtTag::ImportEquals,
                StmtTag::ExportAsNamespace,
            ])
            .export_specs()
            .type_params()
            .enum_members()
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        self.regex.is_some().then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Ident => self.check_reference(e, cx),
            ExprTag::Dot => self.check_property_name(e, cx),
            ExprTag::PrivateIdentifier => {
                if let ExprKind::PrivateIdentifier(name) = e.kind()
                    && self.is_invalid(name, cx)
                {
                    self.report(e.span(), name.bytes(), cx);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.tag() {
            StmtTag::Import => {
                if let StmtKind::Import(import) = statement.kind() {
                    for name in [import.default(), import.namespace()].into_iter().flatten() {
                        self.check_name(name, cx);
                    }
                }
            }
            _ => self.check_statement(statement, cx),
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        self.check_type(ty, cx);
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pat.tag() {
            PatTag::Ident => self.check_binding(pat, cx),
            PatTag::Object => self.check_keys_of_pattern(pat, cx),
            _ => {}
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = func.name()
            && (!self.only_declarations || (func.kind() == FnKind::Decl && func.has_body()))
        {
            self.check_name(name, cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = class.name() {
            self.check_name(name, cx);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        self.check_member(member, cx);
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        self.check_property(prop, cx);
    }

    fn type_param<'a>(&self, param: TypeParam<'a>, cx: &mut Cx<'a, Self>) {
        self.check_name(param.name(), cx);
    }

    fn enum_member<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(key) = member.key() {
            self.check_key(key, cx);
        }
    }

    fn import_spec<'a>(&self, specifier: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        let (imported, local) = (specifier.imported(), specifier.local());
        self.check_name(local, cx);
        if specifier.is_renamed() && imported.name() == local.name() {
            self.check_name(imported, cx);
        }
    }

    fn export_spec<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        match specifier.export().has_from() {
            true => self.check_name(specifier.local(), cx),
            false => self.check_referencing_name(specifier.local(), cx),
        }
        if specifier.is_renamed() {
            self.check_name(specifier.exported(), cx);
        }
    }
}
