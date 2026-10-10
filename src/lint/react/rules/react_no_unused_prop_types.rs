use crate::util_ast::get_property_name_node;
use crate::util_components::Components;
use crate::util_components_list::{Children, Component, DeclaredPropType, PropTypeKind};
use crate::util_prop_types::declared;
use crate::util_prop_types_declaration::UNDEFINED;
use crate::util_used_prop_types::used;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;
use std::borrow::Cow;

/// Disallow definitions of unused propTypes.
pub struct NoUnusedPropTypes {
    ignore: Vec<Box<[u8]>>,
    custom_validators: Vec<Box<[u8]>>,
    skip_shape_props: bool,
}

const UNUSED_PROP_TYPE: Message =
    Message::new("unusedPropType", "'{{name}}' PropType is defined but prop is never used");

impl Rule for NoUnusedPropTypes {
    const META: Meta = Meta::plugin(Plugin::React, "no-unused-prop-types", Kind::None).reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let strings = |key: &str| -> Vec<Box<[u8]>> {
            options.strings(key).into_iter().map(|it| it.as_bytes().into()).collect()
        };
        NoUnusedPropTypes {
            ignore: strings("ignore"),
            custom_validators: strings("customValidators"),
            skip_shape_props: options.bool_or("skipShapeProps", true),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        Components::may_have_any(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let prop_types = declared(&self.custom_validators);
        // An import declares nothing.
        let mut has_declaration = false;
        prop_types.nodes(file, &mut |node, _| has_declaration |= !matches!(node, Node::Stmt(_)));
        if !has_declaration {
            return;
        }
        // Few files without JSX have a component, which the detection alone finds out at a fourth of the price.
        if !file.has_exprs([ExprTag::Jsx]) {
            let mut detection = Components::new(file);
            detection.finish();
            if detection.list().is_empty() {
                return;
            }
        }
        let mut components = Components::new(file).with(prop_types).with(used(file));
        components.finish();
        for id in components.list() {
            let component = components.component(id);
            if !component.ignore_unused_prop_types_validation {
                self.report_unused_prop_types(component, cx);
            }
        }
    }
}

/// `node.typeAnnotation.typeAnnotation.type === "TSNeverKeyword"`
fn is_annotated_with_never(node: Node<'_>) -> bool {
    let annotation = match node {
        Node::Member(signature) => signature.ty(),
        // The `typeAnnotation` of an assertion is its type. An operator and a mapped type have one in turn.
        Node::Expr(e) => match e.kind() {
            ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => match ty.kind() {
                TypeKind::Keyof(operand) | TypeKind::Readonly(operand) | TypeKind::Unique(operand) => Some(operand),
                TypeKind::Mapped(mapped) => mapped.ty(),
                _ => None,
            },
            _ => None,
        },
        _ => None,
    };
    annotation.is_some_and(|it| matches!(it.kind(), TypeKind::Keyword(Keyword::Never)))
}

/// Whether `getKeyValue` of the key of `node` is no string: `1`, `[1n]`, `[null]`, `[/a/]`.
fn is_named_by_no_string(node: Node<'_>) -> bool {
    let Node::Prop(property) = node else {
        return false;
    };
    match property.key().map(Key::kind) {
        Some(KeyKind::Number(_) | KeyKind::ComputedNumber(_)) => true,
        Some(KeyKind::Computed(e)) => !matches!(e.tag(), ExprTag::Ident | ExprTag::String),
        _ => false,
    }
}

/// Puts `props` on `pending`, which is taken from at its end: the first of them last.
fn push_all<'p, 'a>(
    pending: &mut Vec<&'p DeclaredPropType<'a>>,
    props: &mut dyn Iterator<Item = &'p DeclaredPropType<'a>>,
) {
    let from = pending.len();
    pending.extend(props);
    if let Some(added) = pending.get_mut(from..) {
        added.reverse();
    }
}

impl NoUnusedPropTypes {
    /// upstream's `reportUnusedPropTypes`, with `reportUnusedPropType` and `isPropUsed`
    fn report_unused_prop_types<'a>(&self, component: &Component<'a>, cx: &Cx<'a, Self>) {
        let Some(declared_prop_types) = component.declared_prop_types.as_ref().filter(|it| !it.is_empty()) else {
            return;
        };
        let used_prop_types = component.used_prop_types.as_deref().unwrap_or_default();
        let used_names: FxHashSet<(&[u8], bool)> = used_prop_types.iter().map(|it| (it.name, it.is_number)).collect();
        let mut pending = Vec::new();
        push_all(&mut pending, &mut declared_prop_types.iter().map(|(_, prop)| prop));
        while let Some(prop) = pending.pop() {
            let is_shape = matches!(prop.kind, Some(PropTypeKind::Shape | PropTypeKind::Exact));
            if (is_shape && self.skip_shape_props) || prop.node.is_some_and(is_annotated_with_never) {
                continue;
            }
            let full_name = prop.full_name.as_deref();
            // upstream compares with `===` and `indexOf`. In a shape the full name is a string.
            let is_number = prop.node.is_some_and(is_named_by_no_string);
            let is_ignored = !(is_number && prop.full_name == prop.name)
                && full_name.is_some_and(|name| self.ignore.iter().any(|it| name == &**it));
            // Where nothing at all is used, a shape is not used either.
            let is_prop_used = !used_names.is_empty()
                && (is_shape
                    || (prop.name.as_deref())
                        .is_some_and(|name| name == b"__ANY_KEY__" || used_names.contains(&(name, is_number))));
            if let Some(node) = prop.node
                && !is_ignored
                && !is_prop_used
            {
                // `prop.node.key || prop.node`
                let key = if matches!(node, Node::Expr(_)) { None } else { get_property_name_node(node) };
                cx.report(key.unwrap_or_else(|| node.span()), UNUSED_PROP_TYPE)
                    .data("name", prop.full_name.clone().unwrap_or(Cow::Borrowed(UNDEFINED)));
            }
            match &prop.children {
                Children::None => {}
                Children::Named(children) => push_all(&mut pending, &mut children.iter().map(|(_, prop)| prop)),
                Children::Union(children) => push_all(&mut pending, &mut children.iter()),
            }
        }
    }
}
