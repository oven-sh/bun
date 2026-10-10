use crate::oxlint::vue::{
    Enclosing, EnclosingFunctions, as_inner_object_expression, enclosing_function, is_specific_static_name, is_this_object,
    is_vue_component_options_object, is_vue_file, object_of, object_properties, property_of_function,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};

/// Disallow accessing computed properties inside `data()`.
pub struct NoComputedPropertiesInData;

const NO_COMPUTED_PROPERTIES_IN_DATA: Message =
    Message::new("", "The computed property cannot be used in `data()` because it is before initialization.");

#[derive(Default)]
pub struct State<'a> {
    functions: EnclosingFunctions<'a>,
    /// For a function that is the `data` of the options of a component, the names of their computed properties.
    computed_names: FxHashMap<Func<'a>, Option<FxHashSet<Name<'a>>>>,
}

impl Rule for NoComputedPropertiesInData {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-computed-properties-in-data", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Dot]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoComputedPropertiesInData
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (is_vue_file(file) && file.mentions("data") && file.mentions("computed")).then(State::default)
    }

    fn expr<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { obj, name, .. } = member.kind() else {
            return;
        };
        if !member.is_private_member()
            && !member.is_jsx_tag_name()
            && is_this_object(obj)
            && let Some(function) = enclosing_function(Node::Expr(member), Enclosing::FunctionOrArrow, &mut cx.state.functions)
            && let Some(names) = cx.state.computed_names.entry(function).or_insert_with(|| collect_computed_names(function))
            && names.contains(&name.name())
        {
            cx.report(member, NO_COMPUTED_PROPERTIES_IN_DATA);
        }
    }
}

/// `None`: `function` is not the `data` of the options of a component.
fn collect_computed_names(function: Func<'_>) -> Option<FxHashSet<Name<'_>>> {
    let prop = property_of_function(function).filter(|it| is_specific_static_name(*it, "data"))?;
    let ExprKind::Object(options) = object_of(prop).filter(|it| is_vue_component_options_object(*it))?.kind() else {
        return None;
    };
    let computed = object_properties(options).filter(|it| is_specific_static_name(*it, "computed"));
    let entries = computed.filter_map(Prop::value).find_map(as_inner_object_expression);
    let keys = entries.into_iter().flat_map(object_properties).filter_map(Prop::key);
    Some(keys.filter_map(|key| match key.kind() {
        KeyKind::Ident(it) | KeyKind::String(it) => Some(it),
        _ => None,
    }).collect())
}
