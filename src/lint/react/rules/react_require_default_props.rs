use crate::util_ast::name_of_key;
use crate::util_components::Components;
use crate::util_components_list::{DeclaredPropTypes, DefaultProps};
use crate::util_default_props::defaults;
use crate::util_prop_types::{declared, is_in_object_prototype};
use crate::util_prop_types_declaration::UNDEFINED;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;
use std::borrow::Cow;

/// Enforce a defaultProps definition for every prop that is not a required prop.
pub struct RequireDefaultProps {
    forbid_default_for_required: bool,
    ignores_classes: bool,
    functions: Functions,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Functions {
    DefaultArguments,
    DefaultProps,
    Ignore,
}

const NO_DEFAULT_WITH_REQUIRED: Message = Message::new(
    "noDefaultWithRequired",
    "propType \"{{name}}\" is required and should not have a defaultProps declaration.",
);
const SHOULD_HAVE_DEFAULT: Message = Message::new(
    "shouldHaveDefault",
    "propType \"{{name}}\" is not required, but has no corresponding defaultProps declaration.",
);
const NO_DEFAULT_PROPS_WITH_FUNCTION: Message =
    Message::new("noDefaultPropsWithFunction", "Don’t use defaultProps with function components.");
const SHOULD_ASSIGN_OBJECT_DEFAULT: Message = Message::new(
    "shouldAssignObjectDefault",
    "propType \"{{name}}\" is not required, but has no corresponding default argument value.",
);
const DESTRUCTURE_IN_SIGNATURE: Message = Message::new(
    "destructureInSignature",
    "Must destructure props in the function signature to initialize an optional prop.",
);

impl Rule for RequireDefaultProps {
    const META: Meta = Meta::plugin(Plugin::React, "require-default-props", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let functions = match options.str("functions") {
            _ if options.bool_or("ignoreFunctionalComponents", false) => Functions::Ignore,
            Some("defaultArguments") => Functions::DefaultArguments,
            Some("ignore") => Functions::Ignore,
            _ => Functions::DefaultProps,
        };
        RequireDefaultProps {
            forbid_default_for_required: options.bool_or("forbidDefaultForRequired", false),
            ignores_classes: options.str("classes") == Some("ignore"),
            functions,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        Components::may_have_any(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let prop_types = declared(&[]);
        // An import declares nothing.
        let mut has_declaration = false;
        prop_types.nodes(file, &mut |node, _| has_declaration |= !matches!(node, Node::Stmt(_)));
        if !has_declaration {
            return;
        }
        let mut components = Components::new(file).with(prop_types).with(defaults());
        components.finish();
        for id in components.list() {
            let component = components.component(id);
            let is_ignored = match component.node {
                Node::Func(_) => self.functions == Functions::Ignore,
                Node::Class(_) => self.ignores_classes,
                _ => false,
            };
            if is_ignored {
                continue;
            }
            let default_props = match &component.default_props {
                // They may come from elsewhere, or from a spread.
                Some(DefaultProps::Unresolved) => continue,
                Some(DefaultProps::Known(default_props)) => Some(&**default_props),
                None => None,
            };
            let Some(prop_types) = &component.declared_prop_types else { continue };
            match component.node {
                Node::Func(func) if self.functions == Functions::DefaultArguments => {
                    Self::report_function_component(func, prop_types, default_props.is_some(), cx);
                }
                _ => self.report_prop_types_without_default(prop_types, default_props.unwrap_or_default(), cx),
            }
        }
    }
}

impl RequireDefaultProps {
    /// upstream's `reportPropTypesWithoutDefault`
    fn report_prop_types_without_default<'a>(
        &self,
        prop_types: &DeclaredPropTypes<'a>,
        default_props: &[(Cow<'a, [u8]>, Node<'a>)],
        cx: &Cx<'a, Self>,
    ) {
        let default_props: FxHashSet<&[u8]> = default_props.iter().map(|(name, _)| &**name).collect();
        for (prop_name, prop) in prop_types.iter() {
            let Some(node) = prop.node else { continue };
            // `defaultProps[propName]` is also what `Object.prototype` has.
            let has_default = default_props.contains(prop_name) || is_in_object_prototype(prop_name);
            let message = match (prop.is_required == Some(true), has_default) {
                (true, true) if self.forbid_default_for_required => NO_DEFAULT_WITH_REQUIRED,
                (false, false) => SHOULD_HAVE_DEFAULT,
                _ => continue,
            };
            cx.report(node, message).data("name", prop_name.to_vec());
        }
    }

    /// upstream's `reportFunctionComponent`
    fn report_function_component<'a>(
        component_node: Func<'a>,
        prop_types: &DeclaredPropTypes<'a>,
        has_default_props: bool,
        cx: &Cx<'a, Self>,
    ) {
        // With a default it is an `AssignmentPattern`, with `...` a `RestElement`, or it is a `TSParameterProperty`.
        let props = (component_node.params_with_this().next())
            .filter(|it| it.default().is_none() && !it.is_rest() && !it.is_parameter_property());
        let identifier = props.filter(|it| {
            it.pat().tag() == PatTag::Ident && prop_types.iter().any(|(_, it)| it.is_required != Some(true))
        });
        if has_default_props {
            let at = component_node.estree_span();
            let report = cx.report(at, NO_DEFAULT_PROPS_WITH_FUNCTION);
            // `props => ..`: both are said at one place, this one first.
            if identifier.is_some_and(|it| it.binding_span().start == at.start) {
                report.on_exit(true);
            }
        }
        if let Some(identifier) = identifier {
            cx.report(identifier.binding_span(), DESTRUCTURE_IN_SIGNATURE);
        }
        let Some(PatKind::Object(properties)) = props.map(|it| it.pat().kind()) else { return };
        for prop in properties {
            // A rest element.
            let Some(key) = prop.key() else { continue };
            let prop_name = name_of_key(key).unwrap_or(UNDEFINED);
            let is_prop_required = match prop_types.get(prop_name) {
                Some(prop_type) => prop_type.is_required == Some(true),
                // `propTypes[propName]` is what `Object.prototype` has.
                None if is_in_object_prototype(prop_name) => false,
                None => continue,
            };
            let message = match (is_prop_required, prop.default().is_some()) {
                (true, true) => NO_DEFAULT_WITH_REQUIRED,
                (false, false) => SHOULD_ASSIGN_OBJECT_DEFAULT,
                _ => continue,
            };
            cx.report(prop, message).data("name", prop_name);
        }
    }
}
