use crate::import_export_map::{ExportMap, ExportMaps, Got, PARSE_ERRORS};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::{estree_span, estree_type_name};
use rustc_hash::FxHashMap;

/// Forbid imported names marked with `@deprecated` documentation tag.
pub struct NoDeprecated;

const DEPRECATED: Message = Message::new("", "Deprecated: {{description}}");
const DEPRECATED_WITHOUT_DESCRIPTION: Message = Message::new("", "Deprecated.");

/// The description of a `@deprecated` tag.
type Deprecation<'a> = Option<&'a [u8]>;

/// What `checkSpecifiers` reports.
enum Found<'a> {
    Deprecated(Deprecation<'a>),
    /// `reportErrors`: of which module, and `source.value`.
    Errors(ExportMap<'a>, Name<'a>),
}

pub struct State<'a> {
    maps: ExportMaps<'a>,
    deprecated: FxHashMap<Name<'a>, Deprecation<'a>>,
    namespaces: FxHashMap<Name<'a>, ExportMap<'a>>,
    found: Vec<(Span, Found<'a>)>,
    /// Whether the first reference to a name in a scope resolves to a variable of the module. Made when asked for.
    first_references: Option<FxHashMap<(Scope<'a>, Name<'a>), bool>>,
}

impl Rule for NoDeprecated {
    const META: Meta = Meta::plugin(Plugin::Import, "no-deprecated", Kind::Suggestion).needs_modules();
    /// Whatever is an `Identifier` of ESTree, or has one that is not a node here.
    const ON: On = On::new()
        .exprs(&[ExprTag::Ident, ExprTag::Dot, ExprTag::ImportMeta, ExprTag::NewTarget])
        .stmts(&[
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::Break,
            StmtTag::Continue,
            StmtTag::Labeled,
            StmtTag::ImportEquals,
            StmtTag::ExportStar,
            StmtTag::ExportAsNamespace,
        ])
        .types(&[TypeTag::Ref, TypeTag::Import, TypeTag::Predicate])
        .pats(&[PatTag::Ident])
        .funcs()
        .classes()
        .members()
        .props()
        .type_params()
        .enum_members()
        .export_specs()
        .nodes(NodeTags::PAT_PROP.union(NodeTags::TUPLE_ELEM))
        .finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoDeprecated
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if !file.has_stmts([StmtTag::Import]) {
            return None;
        }
        let mut state = State {
            maps: ExportMaps::of(file)?,
            deprecated: FxHashMap::default(),
            namespaces: FxHashMap::default(),
            found: Vec::new(),
            first_references: None,
        };
        for stmt in file.body() {
            if let StmtKind::Import(import) = stmt.kind() {
                state.check_specifiers(import);
            }
        }
        (!state.found.is_empty() || !state.namespaces.is_empty()).then_some(state)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let node = Node::Expr(e);
        match e.kind() {
            ExprKind::Ident(name) => {
                // The `b` of `a[b]` is a property, that of `import(b)` is in an import.
                let is_passed_over = || match e.parent() {
                    Node::Expr(parent) => match parent.kind() {
                        ExprKind::Index { index, .. } => index == e,
                        ExprKind::ImportCall { .. } => true,
                        _ => false,
                    },
                    _ => false,
                };
                if cx.state.deprecated.contains_key(&name) && !e.is_jsx_tag_name() && !is_passed_over() {
                    check_identifier(name, e.span(), node, cx);
                }
            }
            // The right side of a `TSQualifiedName`.
            ExprKind::Dot { name, .. } if e.is_in_type_query() => check_ident(Some(name), node, cx),
            ExprKind::Dot { obj, .. } => {
                if let Some(object) = obj.as_ident()
                    && cx.state.namespaces.contains_key(&object)
                    && !e.is_jsx_tag_name()
                {
                    let around = |it: &Expr<'a>| match it.parent() {
                        Node::Expr(parent) if !it.is_chain_root() => Some(parent),
                        _ => None,
                    };
                    let mut properties = std::iter::successors(Some(e), around).map_while(|it| match it.kind() {
                        ExprKind::Dot { name, .. } => Some(name),
                        _ => None,
                    });
                    check_member_expression(object, node, &mut properties, cx);
                }
            }
            ExprKind::ImportMeta | ExprKind::NewTarget => {
                let name = if e.tag() == ExprTag::ImportMeta { "meta" } else { "target" };
                if let Some((_, property)) = e.meta_property_spans() {
                    check_identifier(cx.file().name_of(name), property, node, cx);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let node = Node::Stmt(stmt);
        match stmt.kind() {
            StmtKind::Interface(it) => check_ident(Some(it.name()), node, cx),
            StmtKind::TypeAlias(it) => check_ident(Some(it.name()), node, cx),
            StmtKind::Enum(it) => check_ident(Some(it.name()), node, cx),
            // The `B` of `namespace A.B` is no statement of its own.
            StmtKind::Module(it) => std::iter::successors(Some(it), |it| it.nested()).for_each(|it| match it.name() {
                ModuleName::Ident(name) => check_ident(Some(name), node, cx),
                ModuleName::Global => check_identifier(cx.file().name_of("global"), it.name_span(), node, cx),
                ModuleName::String(_) => {}
            }),
            StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Labeled { .. } => {
                check_ident(stmt.label(), node, cx);
            }
            StmtKind::ImportEquals(it) => {
                check_ident(Some(it.name()), node, cx);
                if let ImportEqualsTarget::Entity(name) = it.target() {
                    for part in name.parts() {
                        check_ident(Some(part), node, cx);
                    }
                }
            }
            StmtKind::ExportStar { alias, .. } => check_ident(alias, node, cx),
            StmtKind::ExportAsNamespace(_) => check_ident(stmt.namespace_export_name(), node, cx),
            _ => {}
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let node = Node::Type(ty);
        match ty.kind() {
            TypeKind::Ref { name, .. } | TypeKind::Import { name, .. } => {
                let mut parts = name.parts();
                // `extends a.b` of an interface and `implements a.b` are member expressions.
                if name.len() > 1
                    && ty.tag() == TypeTag::Ref
                    && estree_type_name(node) != "TSTypeReference"
                    && let Some(object) = parts.next()
                {
                    check_ident(Some(object), node, cx);
                    check_member_expression(object.name(), node, &mut parts, cx);
                    return;
                }
                for part in parts {
                    check_ident(Some(part), node, cx);
                }
                // In `import("a", { with: { b: "c" } })` they are the properties of an object.
                for attribute in ty.import_attributes().iter().flat_map(|it| it.entries()) {
                    check_key(attribute.key(), node, cx);
                }
            }
            TypeKind::Predicate { .. } => check_ident(ty.predicate_param(), node, cx),
            _ => {}
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = pat.as_ident()
            && cx.state.deprecated.contains_key(&name)
        {
            check_identifier(name, estree_span(pat.into()), pat.into(), cx);
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        check_ident(func.name(), func.into(), cx);
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        check_ident(class.name(), class.into(), cx);
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        check_key(member.key(), member.into(), cx);
        check_ident(member.constructor_keyword(), member.into(), cx);
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if !prop.is_jsx_attribute() {
            check_key(prop.key(), prop.into(), cx);
        }
    }

    fn type_param<'a>(&self, param: TypeParam<'a>, cx: &mut Cx<'a, Self>) {
        check_ident(Some(param.name()), param.into(), cx);
    }

    fn enum_member<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        check_key(member.key(), member.into(), cx);
    }

    fn export_spec<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        check_ident(Some(specifier.local()), specifier.into(), cx);
        check_ident(Some(specifier.exported()), specifier.into(), cx);
    }

    fn node<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        match node {
            Node::PatProp(prop) => check_key(prop.key(), node, cx),
            Node::TupleElem(element) => check_ident(element.name(), node, cx),
            _ => {}
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for (at, found) in std::mem::take(&mut cx.state.found) {
            match found {
                Found::Deprecated(deprecation) => report(at, deprecation, cx),
                Found::Errors(imports, source) => {
                    cx.report(at, PARSE_ERRORS).data("source", source).data("errors", imports.errors_text());
                }
            }
        }
    }
}

impl<'a> State<'a> {
    /// upstream's `checkSpecifiers`
    fn check_specifiers(&mut self, import: Import<'a>) {
        let Some(imports) = self.maps.get(import.spec().bytes()) else {
            return;
        };
        if let Some(deprecation) = self.maps.module_deprecation(imports) {
            self.found.push((import.span(), Found::Deprecated(deprecation)));
        }
        if imports.has_errors() {
            let source = import.spec_span().unwrap_or_else(|| import.span());
            self.found.push((source, Found::Errors(imports, import.spec())));
            return;
        }
        if let Some(local) = import.default() {
            self.check_specifier(imports, b"default", local, local.span());
        }
        if let Some(local) = import.namespace()
            && self.maps.size(imports) > 0
        {
            self.namespaces.insert(local.name(), imports);
        }
        for specifier in import.named() {
            // A name in quotes has no `name`.
            if !specifier.imported().is_string() {
                self.check_specifier(imports, specifier.imported().bytes(), specifier.local(), specifier.span());
            }
        }
    }

    fn check_specifier(&mut self, imports: ExportMap<'a>, imported: &[u8], local: Ident<'a>, at: Span) {
        let Got::Meta(exported) = self.maps.get_export(imports, imported) else {
            return;
        };
        if let Some(namespace) = self.maps.namespace_of(exported) {
            self.namespaces.insert(local.name(), namespace);
        }
        if let Some(deprecation) = self.maps.deprecation(exported) {
            self.found.push((at, Found::Deprecated(deprecation)));
            self.deprecated.insert(local.name(), deprecation);
        }
    }

    /// upstream's `declaredScope(context, name, node) === 'module'`
    fn is_declared_in_module(&mut self, name: Name<'a>, node: Node<'a>) -> bool {
        let State { deprecated, namespaces, first_references, .. } = self;
        let first_references = first_references.get_or_insert_with(|| {
            let mut first_references = FxHashMap::default();
            for reference in node.file().references_as_visited() {
                let name = reference.name();
                // ESLint has the name of a class declaration once more, in the scope of the class.
                let is_name_of_class = |it: Scope<'a>| match it.node() {
                    Node::Class(class) => class.name().is_some_and(|it| it.name() == name),
                    _ => false,
                };
                if deprecated.contains_key(&name) || namespaces.contains_key(&name) {
                    first_references.entry((reference.scope(), name)).or_insert_with(|| {
                        reference.symbol().is_some_and(|it| it.scope().kind() == ScopeKind::Module)
                            && !reference.scope().chain().any(is_name_of_class)
                    });
                }
            }
            first_references
        });
        first_references.get(&(node.scope(), name)) == Some(&true)
    }
}

/// upstream's `message`
fn report<'a>(at: Span, deprecation: Deprecation<'a>, cx: &Cx<'a, NoDeprecated>) {
    match deprecation.filter(|it| !it.is_empty()) {
        Some(description) => cx.report(at, DEPRECATED).data("description", description),
        None => cx.report(at, DEPRECATED_WITHOUT_DESCRIPTION),
    };
}

/// upstream's `Identifier`, for one in `parent` that is neither the property of a member expression nor in an import.
fn check_identifier<'a>(name: Name<'a>, at: Span, parent: Node<'a>, cx: &mut Cx<'a, NoDeprecated>) {
    if let Some(&deprecation) = cx.state.deprecated.get(&name)
        && cx.state.is_declared_in_module(name, parent)
    {
        report(at, deprecation, cx);
    }
}

fn check_ident<'a>(ident: Option<Ident<'a>>, parent: Node<'a>, cx: &mut Cx<'a, NoDeprecated>) {
    if let Some(ident) = ident
        && cx.state.deprecated.contains_key(&ident.name())
        && !ident.is_string()
    {
        check_identifier(ident.name(), ident.span(), parent, cx);
    }
}

fn check_key<'a>(key: Option<Key<'a>>, parent: Node<'a>, cx: &mut Cx<'a, NoDeprecated>) {
    if let Some(key) = key
        && let KeyKind::Ident(name) = key.kind()
        && cx.state.deprecated.contains_key(&name)
    {
        check_identifier(name, key.span(cx.file()), parent, cx);
    }
}

/// upstream's `MemberExpression`. `properties`: that of `node`, whose object is `object`, then those of the member
/// expressions around it.
fn check_member_expression<'a>(
    object: Name<'a>,
    node: Node<'a>,
    properties: &mut dyn Iterator<Item = Ident<'a>>,
    cx: &mut Cx<'a, NoDeprecated>,
) {
    let Some(mut namespace) = cx.state.namespaces.get(&object).copied() else {
        return;
    };
    if !cx.state.is_declared_in_module(object, node) {
        return;
    }
    for property in properties {
        // The `name` of a `PrivateIdentifier` is without the `#`.
        let name = property.bytes().strip_prefix(b"#").unwrap_or_else(|| property.bytes());
        let Got::Meta(metadata) = cx.state.maps.get_export(namespace, name) else {
            return;
        };
        if let Some(deprecation) = cx.state.maps.deprecation(metadata) {
            report(property.span(), deprecation, cx);
        }
        let Some(inner) = cx.state.maps.namespace_of(metadata) else {
            return;
        };
        namespace = inner;
    }
}
