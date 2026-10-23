use crate::import_export_map::{ExportMap, ExportMaps, Got, PARSE_ERRORS};
use bun_lint_oxlint::ast_util::static_property_info;
use bun_lint_oxlint::import::{ImportImportName, import_declarations, import_entries_of};
use bun_lint_oxlint::module_record::{Loaded, StarExports, debug, get_loaded_module, is_waiting_for_modules};
use bun_lint::modules::{ImportName, ModuleId, Record};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

/// Ensure imported namespaces contain dereferenced properties as they are dereferenced.
pub struct Namespace {
    allow_computed: bool,
}

const NO_NAMES: Message = Message::new("", "No exported names found in module '{{source}}'.");
const ASSIGNMENT: Message = Message::new("", "Assignment to member of namespace '{{name}}'.");
const COMPUTED: Message = Message::new("", "Unable to validate computed reference to imported namespace '{{name}}'.");
const NOT_FOUND: Message = Message::new("", "'{{name}}' not found in {{deeply}}imported namespace '{{namepath}}'.");
const ONLY_TOP_LEVEL: Message = Message::new("", "Only destructure top-level names.");
/// `dereference.object.name` when the object isn't an identifier.
const UNDEFINED: &[u8] = b"undefined";

const OXLINT_NO_EXPORT: Message =
    Message::new("", "{{specifier_name}} not found in imported namespace {{namespace_name}}.");
const OXLINT_NO_EXPORT_IN_DEEPLY_IMPORTED_NAMESPACE: Message =
    Message::new("", "{{specifier_name}} not found in deeply imported namespace {{namespace_name}}.");
const OXLINT_COMPUTED_REFERENCE: Message =
    Message::new("", "Unable to validate computed reference to imported namespace {{namespace_name}}.");
const OXLINT_ASSIGNMENT: Message = Message::new("", "Assignment to member of namespace {{namespace_name}}.'");

#[derive(Default)]
pub struct State<'a> {
    /// `None` for oxlint, which uses its module records.
    maps: Option<ExportMaps<'a>>,
    /// `declaredScope(context, name, node) === 'module'`, cached by `node`'s scope.
    declared: FxHashMap<(Scope<'a>, Name<'a>), bool>,
    star_exports: StarExports<'a>,
    namespaces: FxHashMap<ModuleId, Namespaces<'a>>,
}

impl Rule for Namespace {
    const META: Meta = Meta::plugin(Plugin::Import, "namespace", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        Namespace { allow_computed: options.object(0).bool_or("allowComputed", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if !file.language().is_oxlint {
            let maps = file.has_stmts([StmtTag::Import]).then(|| ExportMaps::of(file))??;
            return Some(State { maps: Some(maps), ..State::default() });
        }
        (!is_waiting_for_modules(file) && file.modules().is_some()).then(State::default)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let is_oxlint = cx.state.maps.is_none();
        let mut namespaces = FxHashMap::default();
        let mut seen = FxHashSet::default();
        for declaration in import_declarations(file) {
            let source = declaration.spec().bytes();
            let mut entries = import_entries_of(declaration).peekable();
            if entries.peek().is_none() {
                continue;
            }
            let imports = match &cx.state.maps {
                None => get_loaded_module(file, source).map(Remote::Oxlint),
                Some(maps) => maps.get(source).map(Remote::Eslint),
            };
            let Some(imports) = imports else {
                continue;
            };
            if let (Remote::Eslint(map), Some(at)) = (imports, declaration.spec_span())
                && map.has_errors()
            {
                cx.report(at, PARSE_ERRORS).data("source", source).data("errors", map.errors_text());
                continue;
            }
            for entry in entries {
                let local = entry.local_name().name();
                // If several imports declare the same name, oxlint uses the first and ESLint the last one that's a
                // namespace.
                if is_oxlint && !seen.insert(local) {
                    continue;
                }
                let namespace = match entry.import_name {
                    ImportImportName::NamespaceObject(_) => {
                        if let (Remote::Eslint(map), Some(maps)) = (imports, &cx.state.maps)
                            && let Some(at) = declaration.namespace_span()
                            && maps.size(map) == 0
                        {
                            cx.report(at, NO_NAMES).data("source", source);
                        }
                        Nested::Namespace(source, imports)
                    }
                    ImportImportName::Name(specifier) => imports.nested(specifier.imported().bytes(), cx),
                    // oxlint doesn't look at what the default export is.
                    ImportImportName::Default(_) if is_oxlint => Nested::No,
                    ImportImportName::Default(_) => imports.nested(b"default", cx),
                };
                if let Nested::Namespace(source, module) = namespace {
                    namespaces.insert(local, Lookup { source, namespaces: smallvec![local.bytes()], module });
                }
            }
        }
        if namespaces.is_empty() {
            return;
        }
        let top_level_scope = file.top_level_scope();
        for reference in file.references() {
            let Some(lookup) = namespaces.get(&reference.name()) else {
                continue;
            };
            let Some(ident) = reference.expr() else {
                if !is_oxlint && let Node::Type(heritage) = reference.node() {
                    check_heritage(heritage, lookup.clone(), cx);
                }
                continue;
            };
            // oxlint follows the references to the import, except parenthesized ones, and only into a module that has
            // an `import` or an `export`.
            if let Remote::Oxlint(module) = lookup.module
                && (ident.is_parenthesized()
                    || !module.record.has_module_syntax
                    || reference.symbol().is_none_or(|it| it.scope() != top_level_scope))
            {
                continue;
            }
            self.check_reference(ident, lookup, cx);
        }
    }
}

/// oxlint only: the namespaces of other modules that a module imports or re-exports.
struct Namespaces<'m> {
    /// The specifier of the first `import * as name from "m"` for each name.
    imported: FxHashMap<&'m [u8], &'m [u8]>,
    /// `exported`: for each name, the index and specifier of the first of the `indirect_export_entries` that's an
    /// `export * as name from "m"`. `reexported`: the same for the first entry that exports what's imported as `name`.
    exported: FxHashMap<&'m [u8], (usize, &'m [u8])>,
    reexported: FxHashMap<&'m [u8], (usize, &'m [u8])>,
}

impl<'m> Namespaces<'m> {
    fn new(module_record: &'m Record) -> Self {
        let mut this = Namespaces { imported: FxHashMap::default(), exported: FxHashMap::default(), reexported: FxHashMap::default() };
        for entry in module_record.import_entries.iter().filter(|it| matches!(it.import_name, ImportName::NamespaceObject)) {
            this.imported.entry(&*entry.local_name).or_insert(&*entry.module_request);
        }
        for (number, entry) in module_record.indirect_export_entries.iter().enumerate() {
            match &entry.import_name {
                None => this.exported.entry(&*entry.export_name).or_insert((number, &*entry.module_request)),
                Some(import_name) => this.reexported.entry(&**import_name).or_insert((number, &*entry.module_request)),
            };
        }
        this
    }

    /// Returns the specifier of the module whose namespace this module has as `name`, through `export * as name from
    /// "m"` or `import * as name from "m"`.
    fn get_module_request_name(&self, name: &[u8]) -> Option<&'m [u8]> {
        let namespace = self.imported.get(name).copied();
        let reexported = self.reexported.get(name).filter(|_| namespace.is_some());
        let reexport = self.exported.get(name).into_iter().chain(reexported).min_by_key(|it| it.0);
        reexport.map(|it| it.1).or(namespace)
    }
}

/// Another module, as oxlint or the plugin represents it.
#[derive(Copy, Clone)]
enum Remote<'a> {
    Oxlint(Loaded<'a>),
    Eslint(ExportMap<'a>),
}

/// The result of looking a name up in a module.
enum Nested<'a> {
    /// Not exported, or not a namespace.
    No,
    /// oxlint only: the namespace of a module that isn't loaded.
    Unknown,
    /// The specifier is only set for oxlint.
    Namespace(&'a [u8], Remote<'a>),
}

impl<'a> Remote<'a> {
    fn nested(self, name: &[u8], cx: &mut Cx<'a, Namespace>) -> Nested<'a> {
        let map = match self {
            Remote::Oxlint(module) => {
                let namespaces = cx.state.namespaces.entry(module.module);
                let namespaces = namespaces.or_insert_with(|| Namespaces::new(module.record));
                let Some(source) = namespaces.get_module_request_name(name) else {
                    return Nested::No;
                };
                let loaded = module.get_loaded_module(source);
                return loaded.map_or(Nested::Unknown, |it| Nested::Namespace(source, Remote::Oxlint(it)));
            }
            Remote::Eslint(map) => map,
        };
        match cx.state.maps.as_ref().map(|maps| (maps, maps.get_export(map, name))) {
            Some((maps, Got::Meta(exported))) => {
                maps.namespace_of(exported).map_or(Nested::No, |it| Nested::Namespace(b"", Remote::Eslint(it)))
            }
            _ => Nested::No,
        }
    }
}

/// The namespace that a member is looked up in.
#[derive(Clone)]
struct Lookup<'a> {
    /// oxlint only: the imported module's specifier.
    source: &'a [u8],
    /// The import's local name, then the properties that lead from it to `module`.
    namespaces: SmallVec<[&'a [u8]; 4]>,
    module: Remote<'a>,
}

/// `declaredScope(context, name, node) === 'module'` of eslint-module-utils
fn is_declared_in_module<'a>(name: Name<'a>, node: Node<'a>, cx: &mut Cx<'a, Namespace>) -> bool {
    let scope = node.scope();
    *cx.state.declared.entry((scope, name)).or_insert_with(|| {
        let reference = scope.references().find(|it| it.name() == name);
        reference.and_then(Reference::symbol).is_some_and(|it| it.scope().kind() == ScopeKind::Module)
    })
}

impl Namespace {
    fn check_reference<'a>(&self, ident: Expr<'a>, lookup: &Lookup<'a>, cx: &mut Cx<'a, Self>) {
        let (is_oxlint, Some(name)) = (cx.state.maps.is_none(), ident.as_ident()) else {
            return;
        };
        match ident.parent() {
            Node::Expr(member) if member.is_in_type_query() => {}
            // ESLint doesn't check where the name is declared.
            Node::Expr(member) if member.is_jsx_tag_name() => check_jsx_member_expression(member, lookup, cx),
            Node::Expr(member) if matches!(member.tag(), ExprTag::Dot | ExprTag::Index) => {
                // oxlint doesn't check that it's the member's object.
                if !is_oxlint && (member.object() != Some(ident) || !is_declared_in_module(name, member.into(), cx)) {
                    return;
                }
                if let Node::Expr(parent) = member.parent()
                    && parent.tag() == ExprTag::Assign
                    && parent.left() == Some(member)
                {
                    // oxlint reports the member, and treats a default value in a pattern as an assignment.
                    if is_oxlint {
                        cx.report(member, OXLINT_ASSIGNMENT).data("namespace_name", debug(name.bytes()));
                    } else if !parent.is_assignment_target() {
                        cx.report(parent, ASSIGNMENT).data("name", name);
                    }
                }
                // oxlint reports the member, and ignores computed accesses further along the chain.
                if is_oxlint && !self.allow_computed && member.tag() == ExprTag::Index {
                    cx.report(member, OXLINT_COMPUTED_REFERENCE).data("namespace_name", debug(name.bytes()));
                    return;
                }
                self.check_deep_namespace_for_node(member, lookup.clone(), cx);
            }
            Node::VarDecl(declarator) if declarator.init() == Some(ident) => {
                if is_oxlint || is_declared_in_module(name, ident.into(), cx) {
                    check_deep_namespace_for_object_pattern(declarator.pat(), lookup.clone(), cx);
                }
            }
            _ => {}
        }
    }

    fn check_deep_namespace_for_node<'a>(&self, node: Expr<'a>, mut lookup: Lookup<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.state.maps.is_none();
        let mut node = node;
        loop {
            let property = match node.kind() {
                // oxlint resolves `a["b"]` to a name.
                _ if is_oxlint => static_property_info(node).map(|it| (it.0, it.1.bytes())),
                ExprKind::Dot { name, .. } => {
                    Some((name.span(), name.bytes().strip_prefix(b"#").unwrap_or_else(|| name.bytes())))
                }
                ExprKind::Index { obj, index, .. } if !self.allow_computed => {
                    cx.report(index, COMPUTED).data("name", obj.as_ident().map_or(UNDEFINED, Name::bytes));
                    None
                }
                _ => None,
            };
            let Some((span, name)) = property else {
                return;
            };
            let module = match lookup.module.nested(name, cx) {
                Nested::Namespace(_, module) => module,
                Nested::Unknown => return,
                Nested::No => return check_binding_exported(name, span, &lookup, cx),
            };
            let Node::Expr(parent) = node.parent() else {
                return;
            };
            // oxlint's AST keeps parentheses as nodes, so a chain ends at a parenthesized member.
            if is_oxlint && node.is_parenthesized() || node.is_chain_root() {
                return;
            }
            lookup.module = module;
            lookup.namespaces.push(name);
            node = parent;
        }
    }
}

/// `a.b.c` after `implements`, or after an interface's `extends`, is a `MemberExpression` in ESTree.
fn check_heritage<'a>(heritage: TypeNode<'a>, mut lookup: Lookup<'a>, cx: &mut Cx<'a, Namespace>) {
    let is_heritage = match heritage.parent() {
        Node::Class(class) => class.implements().around(heritage.span().start) == Some(heritage),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Interface(interface) => interface.extends().around(heritage.span().start) == Some(heritage),
            _ => false,
        },
        _ => false,
    };
    let TypeKind::Ref { name, .. } = heritage.kind() else {
        return;
    };
    let Some(object) = name.first().filter(|_| is_heritage) else {
        return;
    };
    if !is_declared_in_module(object.name(), heritage.into(), cx) {
        return;
    }
    for property in name.parts().skip(1) {
        let Nested::Namespace(_, module) = lookup.module.nested(property.bytes(), cx) else {
            return check_binding_exported(property.bytes(), property.span(), &lookup, cx);
        };
        lookup.module = module;
        lookup.namespaces.push(property.bytes());
    }
}

/// `member`: the `a.b` at the start of a tag name. Whether the `a` of a closing tag is a reference depends on the
/// configured parser, so a closing tag is checked together with its opening tag.
fn check_jsx_member_expression<'a>(member: Expr<'a>, lookup: &Lookup<'a>, cx: &mut Cx<'a, Namespace>) {
    let mut tag = member;
    let jsx = loop {
        let Node::Expr(parent) = tag.parent() else {
            return;
        };
        match parent.kind() {
            ExprKind::Jsx(jsx) => break jsx,
            _ => tag = parent,
        }
    };
    if jsx.tag() != Some(tag) {
        return;
    }
    let mut closing = jsx.close_tag();
    while let Some(object) = closing.and_then(Expr::object).filter(|it| it.tag() == ExprTag::Dot) {
        closing = Some(object);
    }
    for property in [Some(member), closing].into_iter().flatten().filter_map(Expr::member_name) {
        check_binding_exported(property.bytes(), property.span(), lookup, cx);
    }
}

fn check_deep_namespace_for_object_pattern<'a>(pattern: Pat<'a>, lookup: Lookup<'a>, cx: &mut Cx<'a, Namespace>) {
    let is_oxlint = cx.state.maps.is_none();
    let mut pending: SmallVec<[(Pat<'a>, Lookup<'a>); 2]> = smallvec![(pattern, lookup)];
    while let Some((pattern, lookup)) = pending.pop() {
        let PatKind::Object(properties) = pattern.kind() else {
            continue;
        };
        for property in properties {
            let Some(key) = property.key() else {
                continue;
            };
            let name = match key.kind() {
                // oxlint accepts any key with a static name.
                _ if is_oxlint => key.name(),
                KeyKind::Ident(name) => Some(name),
                // Upstream doesn't check whether the key is computed.
                KeyKind::Computed(e) => e.as_ident(),
                _ => None,
            };
            let Some(name) = name.map(Name::bytes) else {
                if !is_oxlint {
                    cx.report(property, ONLY_TOP_LEVEL);
                }
                continue;
            };
            let has_pattern = property.value().tag() == PatTag::Object && property.default().is_none();
            let found = if has_pattern { lookup.module.nested(name, cx) } else { Nested::No };
            match found {
                Nested::Namespace(_, module) => {
                    let mut next = Lookup { module, ..lookup.clone() };
                    next.namespaces.push(name);
                    pending.push((property.value(), next));
                }
                Nested::Unknown => {}
                // oxlint reports the key.
                Nested::No if is_oxlint => check_binding_exported(name, key.inner_span(cx.file()), &lookup, cx),
                Nested::No => check_binding_exported(name, property.span(), &lookup, cx),
            }
        }
    }
}

fn check_binding_exported<'a>(name: &'a [u8], span: Span, lookup: &Lookup<'a>, cx: &mut Cx<'a, Namespace>) {
    let is_exported = match lookup.module {
        Remote::Oxlint(module) => {
            module.exports(name)
                || name == b"default" && module.record.has_export_default
                || cx.state.star_exports.contains(module, name)
        }
        Remote::Eslint(map) => cx.state.maps.as_ref().is_some_and(|maps| maps.has(map, name)),
    };
    if is_exported {
        return;
    }
    let (is_deep, namepath) = (lookup.namespaces.len() > 1, lookup.namespaces.join(&b"."[..]));
    if cx.state.maps.is_some() {
        let deeply = if is_deep { "deeply " } else { "" };
        cx.report(span, NOT_FOUND).data("name", name).data("deeply", deeply).data("namepath", namepath);
        return;
    }
    let (message, namespace_name) = match is_deep {
        true => (OXLINT_NO_EXPORT_IN_DEEPLY_IMPORTED_NAMESPACE, debug(&namepath)),
        false => (OXLINT_NO_EXPORT, debug(lookup.source)),
    };
    cx.report(span, message).data("specifier_name", debug(name)).data("namespace_name", namespace_name);
}
