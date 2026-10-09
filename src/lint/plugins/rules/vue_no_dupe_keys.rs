use bun_core::strings;
use crate::oxlint::comments::leading_comments;
use crate::oxlint::vue::{
    EnclosingDeclarators, NamedTypeBudget, enclosing_variable_declarator, first_type_argument,
    for_each_define_props_type_signature, is_vue_component_options_object, is_vue_setup, key_span, object_properties,
    signature_key,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::cell::OnceCell;

/// Disallow duplication of field names.
pub struct NoDupeKeys {
    groups: Vec<Box<str>>,
}

const DUPLICATE_KEY: Message = Message::new("", "Duplicate key '{{name}}'. May cause name collision in script or template tag.");

const GROUP_NAMES: [&str; 5] = ["props", "computed", "data", "methods", "setup"];

#[derive(Default)]
pub struct State<'a> {
    /// Where the tokens start that a comment `@vue/component` is before. Sorted.
    annotated: OnceCell<Vec<u32>>,
    /// Where the outermost statement around a node starts that such a comment can be before.
    outermost_targets: FxHashMap<Node<'a>, Option<u32>>,
    declarators: EnclosingDeclarators<'a>,
    budget: NamedTypeBudget,
}

type Context<'c, 'a> = &'c Cx<'a, NoDupeKeys>;
type Names<'a> = FxHashSet<Cow<'a, [u8]>>;

impl Rule for NoDupeKeys {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-dupe-keys", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoDupeKeys { groups: options.object(0).strings("groups").iter().map(|it| (*it).into()).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.mentions_any(&GROUP_NAMES) || self.groups.iter().any(|it| file.mentions(it)) {
            on.exprs([ExprTag::Object], |rule, e, cx| {
                if let ExprKind::Object(properties) = e.kind()
                    && !properties.is_empty()
                    && (is_vue_component_options_object(e) || has_vue_component_annotation(e, cx))
                {
                    rule.check_component_options(properties, cx);
                }
            });
        }
        if is_vue_setup(file) && file.mentions("defineProps") {
            on.exprs([ExprTag::Call], |_, e, cx| {
                if let Some(call) = e.as_call().filter(|it| it.callee().is_ident("defineProps") && !it.callee().is_parenthesized()) {
                    check_define_props(e, call, cx);
                }
            });
        }
        State::default()
    }
}

/// Where the outermost of the statements around `node` starts that are an expression, a declaration of variables or an export.
fn outermost_target<'a>(node: Node<'a>, known: &mut FxHashMap<Node<'a>, Option<u32>>) -> Option<u32> {
    let target_start = |it: Node<'a>| match it {
        Node::Stmt(stmt)
            if matches!(stmt.tag(), StmtTag::ExportDefault | StmtTag::Expr | StmtTag::Var)
                || stmt.is_exported()
                || stmt.is_default_export() =>
        {
            Some(stmt.span().start)
        }
        _ => None,
    };
    if let Some(&around) = known.get(&node) {
        return around;
    }
    // From `node` up to a node that it is known of.
    let mut passed = Vec::new();
    let mut at = node;
    let mut outermost = loop {
        if matches!(at, Node::File(_)) {
            break None;
        }
        if let Some(&around) = known.get(&at) {
            break around.or_else(|| target_start(at));
        }
        passed.push(at);
        at = at.parent();
    };
    let mut around_node = outermost;
    for it in passed.into_iter().rev() {
        around_node = outermost;
        known.insert(it, outermost);
        outermost = outermost.or_else(|| target_start(it));
    }
    around_node
}

/// A comment `@vue/component` is before the outermost statement that `node` is in.
fn has_vue_component_annotation<'a>(node: Expr<'a>, cx: &mut Cx<'a, NoDupeKeys>) -> bool {
    let file = cx.file();
    let annotated = cx.state.annotated.get_or_init(|| {
        let is_annotation = |it: &Token| strings::trim_js_whitespace(it.comment_value()) == b"@vue/component";
        match file.comments().any(|it| is_annotation(&it)) {
            true => leading_comments(file).iter().filter(|it| is_annotation(&it.0)).map(|it| it.1).collect(),
            false => Vec::new(),
        }
    });
    if annotated.is_empty() {
        return false;
    }
    let target_start = outermost_target(Node::Expr(node), &mut cx.state.outermost_targets).unwrap_or_else(|| node.span().start);
    annotated.binary_search(&target_start).is_ok()
}

fn literal_element_name(expr: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    Some(match expr.kind() {
        ExprKind::String(value) | ExprKind::BigInt(value) => Cow::Borrowed(value.bytes()),
        ExprKind::Template(template) => Cow::Borrowed(template.as_static()?.bytes()),
        ExprKind::Number(value) => Cow::Owned(text::number_to_string(value)),
        ExprKind::True => Cow::Borrowed(b"true"),
        ExprKind::False => Cow::Borrowed(b"false"),
        ExprKind::Regex(_) => Cow::Borrowed(expr.text()),
        _ => return None,
    })
}

fn static_key_name(key: Key<'_>) -> Option<Cow<'_, [u8]>> {
    match key.kind() {
        KeyKind::Computed(e) => literal_element_name(e).filter(|_| !e.is_parenthesized()),
        KeyKind::Private(_) => None,
        _ => key.name().map(|it| Cow::Borrowed(it.bytes())),
    }
}

fn report_or_add<'a>(name: Cow<'a, [u8]>, span: Span, seen: &mut Names<'a>, cx: Context<'_, 'a>) {
    if seen.contains(&name) {
        cx.report(span, DUPLICATE_KEY).data("name", name);
    } else {
        seen.insert(name);
    }
}

fn collect_object_keys<'a>(properties: List<'a, Prop<'a>>, seen: &mut Names<'a>, cx: Context<'_, 'a>) {
    let names = || object_properties(properties).filter_map(|it| Some((it, static_key_name(it.key()?)?)));
    let getter_names: Names<'a> = names().filter(|it| it.0.kind() == PropKind::Getter).map(|it| it.1).collect();
    let mut used_getters: Names<'a> = FxHashSet::default();
    for (prop, name) in names().filter(|it| !it.1.is_empty()) {
        // A setter goes with a getter.
        if prop.kind() == PropKind::Setter && getter_names.contains(&name) && !used_getters.contains(&name) {
            used_getters.insert(name);
        } else {
            report_or_add(name, key_span(prop), seen, cx);
        }
    }
}

fn collect_group_keys<'a>(value: Expr<'a>, seen: &mut Names<'a>, cx: Context<'_, 'a>) {
    let mut collect_if_object = |e: Expr<'a>| {
        if let ExprKind::Object(properties) = e.kind() {
            collect_object_keys(properties, seen, cx);
        }
    };
    match value.kind() {
        ExprKind::Array(elements) => {
            for (element, name) in elements.iter().filter_map(|it| Some((it, literal_element_name(it)?))) {
                if !name.is_empty() {
                    report_or_add(name, element.span(), seen, cx);
                }
            }
        }
        ExprKind::Object(_) => collect_if_object(value),
        ExprKind::Fn(func) => match func.body() {
            FnBody::Expr(e) => collect_if_object(e),
            FnBody::Block(statements) => {
                for stmt in statements {
                    if let StmtKind::Return(Some(returned)) = stmt.kind() {
                        collect_if_object(returned);
                    }
                }
            }
            FnBody::None => {}
        },
        _ => {}
    }
}

impl NoDupeKeys {
    fn check_component_options<'a>(&self, properties: List<'a, Prop<'a>>, cx: Context<'_, 'a>) {
        let mut seen: Names<'a> = FxHashSet::default();
        for prop in object_properties(properties) {
            if let Some(group_name) = prop.key().and_then(static_key_name)
                && GROUP_NAMES.iter().copied().chain(self.groups.iter().map(|it| &**it)).any(|it| it.as_bytes() == &*group_name)
                && let Some(value) = prop.value()
            {
                collect_group_keys(value, &mut seen, cx);
            }
        }
    }
}

fn collect_prop_names_from_call<'a>(call: Call<'a>, budget: &NamedTypeBudget) -> Vec<Cow<'a, [u8]>> {
    let mut props = Vec::new();
    match call.args().first().filter(|it| it.tag() != ExprTag::Spread).map(Expr::kind) {
        Some(ExprKind::Object(properties)) => {
            props.extend(object_properties(properties).filter_map(Prop::key).filter_map(static_key_name));
        }
        Some(ExprKind::Array(elements)) => props.extend(elements.iter().filter_map(literal_element_name)),
        Some(_) => {}
        None => {
            if let Some(first_type) = first_type_argument(call) {
                let mut add = |it| props.extend(signature_key(it).and_then(static_key_name));
                for_each_define_props_type_signature(first_type, budget, &mut add);
            }
        }
    }
    props
}

/// `call`, `withDefaults(call, ..)`
fn is_define_props_initializer<'a>(init: Expr<'a>, call: Expr<'a>) -> bool {
    let mut init = init;
    loop {
        if init.is_parenthesized() || init.is_chain_root() {
            return false;
        }
        if init == call {
            return true;
        }
        match init.as_call().filter(|it| it.callee().is_ident("withDefaults") && !it.callee().is_parenthesized()) {
            Some(with_defaults) => match with_defaults.args().first() {
                Some(first) => init = first,
                None => return false,
            },
            None => return false,
        }
    }
}

/// Where what `const props = defineProps()` and `const { a, b: c } = defineProps()` declare is referred to, sorted. And the names of
/// the props that have another name there, like `b`.
///
/// `declarator`: the innermost around `node`.
fn collect_props_bindings<'a>(node: Expr<'a>, declarator: Option<VarDecl<'a>>) -> (Vec<u32>, FxHashSet<Name<'a>>) {
    let (mut references, mut renamed) = (Vec::new(), FxHashSet::default());
    let is_initialized_with_props = |it: &VarDecl<'a>| it.init().is_some_and(|init| is_define_props_initializer(init, node));
    let Some(declarator) = declarator.filter(is_initialized_with_props) else {
        return (references, renamed);
    };
    // Not what is in an array pattern.
    let mut pending = vec![declarator.pat()];
    while let Some(pattern) = pending.pop() {
        match pattern.kind() {
            PatKind::Ident(_) => {
                references.extend(pattern.symbol().into_iter().flat_map(Symbol::references).map(|it| it.node().span().start));
            }
            PatKind::Object(properties) => pending.extend(properties.iter().map(PatProp::value)),
            _ => {}
        }
    }
    references.sort_unstable();
    if let PatKind::Object(properties) = declarator.pat().kind() {
        for property in properties.iter().filter(|it| !it.is_rest() && it.default().is_none()) {
            if let Some(KeyKind::Ident(key)) = property.key().map(Key::kind)
                && property.value().as_ident().is_some_and(|it| it != key)
            {
                renamed.insert(key);
            }
        }
    }
    (references, renamed)
}

fn check_define_props<'a>(node: Expr<'a>, call: Call<'a>, cx: &mut Cx<'a, NoDupeKeys>) {
    let props = collect_prop_names_from_call(call, &cx.state.budget);
    if props.is_empty() {
        return;
    }
    let declarator = enclosing_variable_declarator(node, &mut cx.state.declarators);
    let (props_references, renamed) = collect_props_bindings(node, declarator);
    let root_scope = cx.file().top_level_scope();
    for prop_name in &props {
        let Some(symbol) = root_scope.get_bytes(prop_name).filter(|it| !renamed.contains(&it.name()) && it.is_value_variable()) else {
            continue;
        };
        let Some(declaration) = symbol.declarations().next() else {
            continue;
        };
        let span = match (declaration, declaration.node()) {
            (_, Some(Node::VarDecl(declarator))) => {
                // What is made of the props is not another thing of that name.
                let is_from_props = declarator.init().map(|it| it.outer_span()).is_some_and(|init| {
                    let first_in_init = props_references.get(props_references.partition_point(|it| *it < init.start));
                    init.contains(node.span()) || first_in_init.is_some_and(|it| *it < init.end)
                });
                if is_from_props {
                    continue;
                }
                declarator.pat().span()
            }
            (Declaration::Fn(func), _) => func.estree_span(),
            (Declaration::Class(class), _) => class.estree_span(),
            // What `import type` declares is no value.
            (Declaration::ImportDefault(import) | Declaration::ImportNamespace(import), _) if import.is_type_only() => continue,
            (Declaration::ImportSpec(specifier), _) if specifier.is_type_only() || specifier.import().is_type_only() => continue,
            (Declaration::ImportDefault(_), _) => declaration.name_span().unwrap_or_default(),
            (Declaration::ImportNamespace(import), _) => import.namespace_span().unwrap_or_default(),
            (Declaration::ImportSpec(specifier), _) => specifier.span(),
            (_, Some(Node::Stmt(stmt))) => stmt.span_without_export(),
            _ => continue,
        };
        cx.report(span, DUPLICATE_KEY).data("name", prop_name.to_vec());
    }
}
