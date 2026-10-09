use bun_lint_oxlint::ast_util::static_property_info;
use bun_lint_oxlint::import::{ImportImportName, import_entries};
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

const NO_EXPORT: Message = Message::new("", "{{specifier_name}} not found in imported namespace {{namespace_name}}.");
const NO_EXPORT_IN_DEEPLY_IMPORTED_NAMESPACE: Message =
    Message::new("", "{{specifier_name}} not found in deeply imported namespace {{namespace_name}}.");
const COMPUTED_REFERENCE: Message =
    Message::new("", "Unable to validate computed reference to imported namespace {{namespace_name}}.");
const ASSIGNMENT: Message = Message::new("", "Assignment to member of namespace {{namespace_name}}.'");

#[derive(Default)]
pub struct State<'a> {
    star_exports: StarExports<'a>,
    namespaces: FxHashMap<ModuleId, Namespaces<'a>>,
}

impl Rule for Namespace {
    const META: Meta = Meta::oxlint(Plugin::Import, "namespace", Kind::Problem).needs_modules();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        Namespace { allow_computed: options.object(0).bool_or("allowComputed", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if !is_waiting_for_modules(file) && file.modules().is_some() {
            on.finish(Self::check);
        }
        State::default()
    }
}

/// The namespaces of other modules that a module has.
struct Namespaces<'m> {
    /// The specifier of the first `import * as name from "m"` for each name.
    imported: FxHashMap<&'m [u8], &'m [u8]>,
    /// The number and the specifier of the first of the `indirect_export_entries` that is an `export * as name from "m"`, and that
    /// exports what is imported as `name`.
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

    /// The specifier of the module whose namespace the module has under `name`: `export * as name from "m"`, or
    /// `import * as name from "m"`.
    fn get_module_request_name(&self, name: &[u8]) -> Option<&'m [u8]> {
        let namespace = self.imported.get(name).copied();
        let reexported = self.reexported.get(name).filter(|_| namespace.is_some());
        let reexport = self.exported.get(name).into_iter().chain(reexported).min_by_key(|it| it.0);
        reexport.map(|it| it.1).or(namespace)
    }
}

fn get_module_request_name<'a>(name: &[u8], module: Loaded<'a>, cx: &mut Cx<'a, Namespace>) -> Option<&'a [u8]> {
    cx.state.namespaces.entry(module.module).or_insert_with(|| Namespaces::new(module.record)).get_module_request_name(name)
}

/// The namespace that something is looked up in.
#[derive(Clone)]
struct Place<'a> {
    /// The specifier of the module that is imported.
    source: &'a [u8],
    /// The name of the import, and the properties that lead from there to `module`.
    namespaces: SmallVec<[&'a [u8]; 4]>,
    module: Loaded<'a>,
}

impl Namespace {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        // Once, if a name is declared several times.
        let mut seen = FxHashSet::default();
        for entry in import_entries(file).filter(|it| seen.insert(it.local_name().name())) {
            let Some(loaded_module) = get_loaded_module(file, entry.declaration.spec().bytes()) else {
                continue;
            };
            let (source, module) = match entry.import_name {
                ImportImportName::NamespaceObject(_) => (entry.declaration.spec().bytes(), loaded_module),
                ImportImportName::Name(specifier) => {
                    let Some(source) = get_module_request_name(specifier.imported().bytes(), loaded_module, cx) else {
                        continue;
                    };
                    let Some(module) = loaded_module.get_loaded_module(source) else {
                        continue;
                    };
                    (source, module)
                }
                ImportImportName::Default(_) => continue,
            };
            let local = entry.local_name().name();
            let Some(symbol) = file.top_level_scope().get_name(local).filter(|_| module.record.has_module_syntax) else {
                continue;
            };
            let place = Place { source, namespaces: smallvec![local.bytes()], module };
            for ident in symbol.references().filter_map(Reference::expr).filter(|it| !it.is_parenthesized()) {
                self.check_reference(ident, &place, cx);
            }
        }
    }

    fn check_reference<'a>(&self, ident: Expr<'a>, place: &Place<'a>, cx: &mut Cx<'a, Self>) {
        match ident.parent() {
            Node::Expr(member) if member.is_in_type_query() => {}
            Node::Expr(member) if member.is_jsx_tag_name() => check_jsx_member_expression(member, place, cx),
            Node::Expr(member) if matches!(member.tag(), ExprTag::Dot | ExprTag::Index) => {
                let name = || debug(place.namespaces.first().copied().unwrap_or_default());
                if matches!(member.parent(), Node::Expr(e) if e.tag() == ExprTag::Assign && e.left() == Some(member)) {
                    cx.report(member, ASSIGNMENT).data("namespace_name", name());
                }
                if !self.allow_computed && member.tag() == ExprTag::Index {
                    cx.report(member, COMPUTED_REFERENCE).data("namespace_name", name());
                    return;
                }
                check_deep_namespace_for_node(member, place.clone(), cx);
            }
            Node::VarDecl(declarator) if declarator.init() == Some(ident) => {
                check_deep_namespace_for_object_pattern(declarator.pat(), place.clone(), cx);
            }
            _ => {}
        }
    }
}

/// `member`: the `a.b` at the start of the name in a tag. Whether the `a` of a closing tag is a reference depends on the parser that is
/// configured, so a closing tag is looked at with its opening tag.
fn check_jsx_member_expression<'a>(member: Expr<'a>, place: &Place<'a>, cx: &mut Cx<'a, Namespace>) {
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
        check_binding_exported(property.bytes(), property.span(), place, cx);
    }
}

fn check_deep_namespace_for_node<'a>(node: Expr<'a>, mut place: Place<'a>, cx: &mut Cx<'a, Namespace>) {
    let mut node = node;
    while let Some((span, name)) = static_property_info(node) {
        let name = name.bytes();
        let Some(module_source) = get_module_request_name(name, place.module, cx) else {
            return check_binding_exported(name, span, &place, cx);
        };
        let (Some(module), Node::Expr(parent)) = (place.module.get_loaded_module(module_source), node.parent()) else {
            return;
        };
        // In parentheses it is part of nothing that is looked at.
        if node.is_parenthesized() || node.is_chain_root() {
            return;
        }
        place.module = module;
        place.namespaces.push(name);
        node = parent;
    }
}

fn check_deep_namespace_for_object_pattern<'a>(pattern: Pat<'a>, place: Place<'a>, cx: &mut Cx<'a, Namespace>) {
    let mut pending: SmallVec<[(Pat<'a>, Place<'a>); 2]> = smallvec![(pattern, place)];
    while let Some((pattern, place)) = pending.pop() {
        let PatKind::Object(properties) = pattern.kind() else {
            continue;
        };
        for property in properties {
            let Some((key, name)) = property.key().and_then(|key| Some((key, key.name()?.bytes()))) else {
                continue;
            };
            if property.value().tag() == PatTag::Object
                && property.default().is_none()
                && let Some(module_source) = get_module_request_name(name, place.module, cx)
            {
                if let Some(module) = place.module.get_loaded_module(module_source) {
                    let mut next = Place { module, ..place.clone() };
                    next.namespaces.push(name);
                    pending.push((property.value(), next));
                }
                continue;
            }
            check_binding_exported(name, key.inner_span(cx.file()), &place, cx);
        }
    }
}

fn check_binding_exported<'a>(name: &[u8], span: Span, place: &Place<'a>, cx: &mut Cx<'a, Namespace>) {
    let module = place.module;
    if module.exports(name) || name == b"default" && module.record.has_export_default || cx.state.star_exports.contains(module, name) {
        return;
    }
    let (message, namespace_name) = match place.namespaces.len() > 1 {
        true => (NO_EXPORT_IN_DEEPLY_IMPORTED_NAMESPACE, debug(&place.namespaces.join(&b"."[..]))),
        false => (NO_EXPORT, debug(place.source)),
    };
    cx.report(span, message).data("specifier_name", debug(name)).data("namespace_name", namespace_name);
}
