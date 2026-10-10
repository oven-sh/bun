use bun_lint_oxlint::ast_util::{as_method_definition, as_object_property, static_name};
use crate::react::{get_parent_component, is_es5_component, is_jsx, supports_unsafe_lifecycle_prefix};
use crate::util_ast::{Property, get_component_properties, get_property_name};
use crate::util_component_util::{self, Pragmas};
use crate::util_version::get_react_version_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow usage of unsafe lifecycle methods
pub struct NoUnsafe {
    check_aliases: bool,
}

const UNSAFE_METHOD: Message = Message::new(
    "unsafeMethod",
    "{{method}} is unsafe for use in async rendering. Update the component to use {{newMethod}} instead. {{details}}",
);
const NO_UNSAFE: Message = Message::new("", "Unsafe lifecycle method `{{method_name}}` is not allowed");

const DETAILS: &str = "See https://reactjs.org/blog/2018/03/27/update-on-async-rendering.html.";

/// Also as private names: upstream goes by the `name` of a `PrivateIdentifier`, which is without the `#`.
const UNSAFE_METHODS: [&str; 6] = [
    "UNSAFE_componentWillMount",
    "UNSAFE_componentWillReceiveProps",
    "UNSAFE_componentWillUpdate",
    "#UNSAFE_componentWillMount",
    "#UNSAFE_componentWillReceiveProps",
    "#UNSAFE_componentWillUpdate",
];
const ALIASES: [&str; 6] = [
    "componentWillMount",
    "componentWillReceiveProps",
    "componentWillUpdate",
    "#componentWillMount",
    "#componentWillReceiveProps",
    "#componentWillUpdate",
];

pub struct State<'a> {
    check_unsafe_prefix: bool,
    parent_component: AncestorMemo<'a, Node<'a>>,
    in_es5_component: AncestorMemo<'a, ()>,
    pragmas: Pragmas<'a>,
    /// Where the first property of a name is in a class or an object literal.
    first: FxHashMap<(Node<'a>, &'a [u8]), Span>,
}

impl Rule for NoUnsafe {
    const META: Meta = Meta::plugin(Plugin::React, "no-unsafe", Kind::Problem);
    const ON: On = On::new().members().props();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoUnsafe { check_aliases: options.object(0).bool_or("checkAliases", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let is_oxlint = file.language().is_oxlint;
        if (is_oxlint && !is_jsx(file))
            || !(file.mentions_any(&UNSAFE_METHODS) || self.check_aliases && file.mentions_any(&ALIASES))
        {
            return None;
        }
        // oxlint takes no `"detect"` and has no default. It looks for the aliases whatever the version is.
        let check_unsafe_prefix = match is_oxlint {
            true => supports_unsafe_lifecycle_prefix(file),
            false => get_react_version_from_context(file) >= (16, 3, 0),
        };
        (is_oxlint || check_unsafe_prefix).then(|| State {
            check_unsafe_prefix,
            parent_component: AncestorMemo::default(),
            in_es5_component: AncestorMemo::default(),
            pragmas: Pragmas::new(file),
            first: FxHashMap::default(),
        })
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint looks at methods only.
        if !cx.language().is_oxlint || as_method_definition(Node::Member(member)).is_some() {
            self.check(Node::Member(member), member.key(), cx);
        }
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if as_object_property(Node::Prop(prop)).is_some() {
            self.check(Node::Prop(prop), prop.key(), cx);
        }
    }
}

impl NoUnsafe {
    /// `property`: a member of a class or a property of an object literal.
    fn check<'a>(&self, property: Node<'a>, key: Option<Key<'a>>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        // upstream goes by `key.name`: `[a]` and `#a` are `a`, and `"a"` has none.
        let name = if is_oxlint { key.and_then(static_name).map(Name::bytes) } else { get_property_name(property) };
        let Some((method, new_method)) = name.and_then(|it| Some((it, self.new_method(it, cx)?))) else {
            return;
        };
        if is_oxlint {
            // oxlint looks for the component anywhere around it, and points at the key.
            let is_in_component = match property {
                Node::Member(_) => get_parent_component(property, &mut cx.state.parent_component).is_some(),
                _ => {
                    let in_es5_component = &mut cx.state.in_es5_component;
                    in_es5_component.find(property, |_, ancestor| is_es5_component(ancestor).then_some(())).is_some()
                }
            };
            if is_in_component && let Some(key) = key {
                cx.report(key.inner_span(cx.file()), NO_UNSAFE)
                    .data("method_name", method)
                    .data("replacement", new_method);
            }
            return;
        }
        let (node, pragmas) = (property.parent(), cx.state.pragmas);
        if !util_component_util::is_es5_component(node, &pragmas)
            && !matches!(node, Node::Class(class) if util_component_util::is_es6_component(class, &pragmas))
        {
            return;
        }
        // upstream reports each property of a name at the first one.
        let property_node = *cx.state.first.entry((node, method)).or_insert_with(|| {
            let first = get_component_properties(node).into_iter().find(|it| it.name() == Some(method));
            first.map_or(property, Property::node).span()
        });
        cx.report(property_node, UNSAFE_METHOD)
            .data("method", method)
            .data("newMethod", new_method)
            .data("details", DETAILS);
    }

    /// What is to be used in the place of the method `name`, if that is one that is looked for.
    fn new_method(&self, name: &[u8], cx: &Cx<'_, Self>) -> Option<&'static str> {
        let (alias, is_checked) = match name.strip_prefix(b"UNSAFE_") {
            Some(alias) => (alias, cx.state.check_unsafe_prefix),
            None => (name, self.check_aliases),
        };
        if !is_checked {
            return None;
        }
        match alias {
            b"componentWillMount" => Some("componentDidMount"),
            b"componentWillReceiveProps" => Some("getDerivedStateFromProps"),
            b"componentWillUpdate" => Some("componentDidUpdate"),
            _ => None,
        }
    }
}
