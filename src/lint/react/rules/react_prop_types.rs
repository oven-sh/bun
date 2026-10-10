use crate::util_components::Components;
use crate::util_components_list::{Children, Component, DeclaredPropType, DeclaredPropTypes, UsedPropType};
use crate::util_prop_types::{declared, is_in_object_prototype};
use crate::util_used_prop_types::used;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_parent;

/// Disallow missing props validation in a React component definition.
pub struct PropTypes {
    ignore: Vec<Box<[u8]>>,
    custom_validators: Vec<Box<[u8]>>,
    skip_undeclared: bool,
}

const MISSING_PROP_TYPE: Message = Message::new("missingPropType", "'{{name}}' is missing in props validation");

impl Rule for PropTypes {
    const META: Meta = Meta::plugin(Plugin::React, "prop-types", Kind::None).recommended().reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let names = |key: &str| -> Vec<Box<[u8]>> {
            options.strings(key).into_iter().map(|it| it.as_bytes().into()).collect()
        };
        PropTypes {
            ignore: names("ignore"),
            custom_validators: names("customValidators"),
            skip_undeclared: options.bool_or("skipUndeclared", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        Components::may_have_any(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        // The stages look at every function, and few files without JSX have a component.
        if !file.has_exprs([ExprTag::Jsx]) {
            let mut detection = Components::new(file);
            detection.finish();
            if detection.length() == 0 {
                return;
            }
        }
        let mut components = Components::new(file).with(declared(&self.custom_validators)).with(used(file));
        components.finish();
        let nothing = DeclaredPropTypes::default();
        let mut around = AncestorMemo::default();
        let list = components.list();
        let is_certain = |node| components.get(node).is_some_and(|it| components.component(it).confidence >= 2);
        for id in list {
            let component = components.component(id);
            let used_prop_types = component.used_prop_types.as_deref().unwrap_or_default();
            if used_prop_types.is_empty()
                || !self.must_be_validated(component)
                || self.check_nested_component(component, &components)
            {
                continue;
            }
            // upstream's `isDeclaredInComponent` asks the component, and each that it is in.
            let mut declaring = Vec::new();
            let mut certain = Some(component.node);
            while let Some(node) = certain {
                let declared_prop_types =
                    components.get(node).and_then(|it| components.component(it).declared_prop_types.as_ref());
                declaring.push(declared_prop_types.unwrap_or(&nothing));
                certain = around.find_with(node, estree_parent, |_, parent| is_certain(parent).then_some(parent));
            }
            self.report_undeclared_prop_types(used_prop_types, &declaring, cx);
        }
    }
}

/// upstream's `internalIsDeclaredInComponent`. `None`: the `children` of what has none.
fn internal_is_declared_in_component(declared_prop_types: Option<&DeclaredPropTypes<'_>>, key_list: &[&[u8]]) -> bool {
    let Some((&key, rest)) = key_list.split_first() else {
        return true;
    };
    // If it's a computed property, we can't make any further analysis, but is valid
    let is_computed = key == b"__COMPUTED_PROP__";
    let Some(declared_prop_types) = declared_prop_types else {
        return is_computed;
    };
    if let Some(prop_type) = declared_prop_types.get(key) {
        return accepts(prop_type, key_list);
    }
    if is_in_object_prototype(key) {
        // `Object.prototype` is an object without a `type`. The others are functions: no `children`.
        return key == b"__proto__" || internal_is_declared_in_component(None, rest);
    }
    // If not, check if this type accepts any key
    declared_prop_types.get(b"__ANY_KEY__").map_or(is_computed, |it| accepts(it, key_list))
}

/// What `internalIsDeclaredInComponent` goes on to do with the `propType` of the first of `key_list`.
fn accepts(prop_type: &DeclaredPropType<'_>, key_list: &[&[u8]]) -> bool {
    let rest = key_list.get(1..).unwrap_or_default();
    match &prop_type.children {
        _ if prop_type.kind.is_none() => true,
        // The last key accepts everything.
        Children::Union(union_types) => rest.is_empty() || union_types.iter().any(|it| accepts(it, key_list)),
        Children::Named(children) => internal_is_declared_in_component(Some(children), rest),
        Children::None => internal_is_declared_in_component(None, rest),
    }
}

impl PropTypes {
    /// upstream's `mustBeValidated`
    fn must_be_validated(&self, component: &Component<'_>) -> bool {
        let is_skipped_by_config = self.skip_undeclared && component.declared_prop_types.is_none();
        component.used_prop_types.is_some() && !component.ignore_props_validation && !is_skipped_by_config
    }

    /// upstream's `checkNestedComponent`. Where that throws, it is not nested.
    fn check_nested_component<'a>(&self, component: &Component<'a>, components: &Components<'a>) -> bool {
        let Node::Expr(node) = component.node else {
            return false;
        };
        let (ExprKind::Call(call) | ExprKind::New(call)) = node.kind() else {
            return false;
        };
        let Some(argument) = call.args().first().filter(|it| !it.is_chain_root()) else {
            return false;
        };
        if !call.callee().is_ident("memo") || !argument.callee().is_some_and(|it| it.is_ident("forwardRef")) {
            return false;
        }
        // No other node that can be a component starts where the argument does.
        let forward_component = components.get(Node::Expr(argument)).map(|it| components.component(it));
        forward_component
            .is_some_and(|it| it.confidence >= 2 && (it.ignore_props_validation || self.must_be_validated(it)))
    }

    /// upstream's `reportUndeclaredPropTypes`
    fn report_undeclared_prop_types<'a>(
        &self,
        used_prop_types: &[UsedPropType<'a>],
        declaring: &[&DeclaredPropTypes<'a>],
        cx: &Cx<'a, Self>,
    ) {
        for prop_type in used_prop_types {
            let all_names = prop_type.all_names.as_slice();
            let is_ignored = all_names.first().is_some_and(|&name| self.ignore.iter().any(|it| name == &**it));
            if !is_ignored && !declaring.iter().any(|&it| internal_is_declared_in_component(Some(it), all_names)) {
                let name = strings::replace_owned(&all_names.join(&b"."[..]), b".__COMPUTED_PROP__", b"[]");
                cx.report(prop_type.at, MISSING_PROP_TYPE).data("name", name);
            }
        }
    }
}
