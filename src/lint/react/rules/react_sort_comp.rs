use crate::util_ast::{Property, get_component_properties};
use crate::util_components::Components;
use crate::util_pragma::{get_create_class_from_context, mentions_create_class};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::SyntaxError;
use bun_lint::rule::Plugin;
use std::sync::LazyLock;

/// Enforce component methods order
pub struct SortComp {
    /// `None`: [`Rule::validate`] has refused the options, and the rule does not run.
    methods_order: Option<MethodsOrder>,
}

const UNSORTED_PROPS: Message = Message::new("unsortedProps", "{{propA}} should be placed {{position}} {{propB}}");

const DEFAULT_ORDER: [&str; 4] = ["static-methods", "lifecycle", "everything-else", "render"];
const LIFECYCLE: [&str; 25] = [
    "displayName",
    "propTypes",
    "contextTypes",
    "childContextTypes",
    "mixins",
    "statics",
    "defaultProps",
    "constructor",
    "getDefaultProps",
    "state",
    "getInitialState",
    "getChildContext",
    "getDerivedStateFromProps",
    "componentWillMount",
    "UNSAFE_componentWillMount",
    "componentDidMount",
    "componentWillReceiveProps",
    "UNSAFE_componentWillReceiveProps",
    "shouldComponentUpdate",
    "componentWillUpdate",
    "UNSAFE_componentWillUpdate",
    "getSnapshotBeforeUpdate",
    "componentDidUpdate",
    "componentDidCatch",
    "componentWillUnmount",
];

static REG_EXP_REG_EXP: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r"/\/(.*)\/([gimsuy]*)/"));

/// What an element of upstream's `propertiesInfos` has beside the name, as bits.
type Kinds = u8;
const GETTER: Kinds = 1 << 0;
const SETTER: Kinds = 1 << 1;
const TYPE_ANNOTATION: Kinds = 1 << 2;
const STATIC_VARIABLE: Kinds = 1 << 3;
const STATIC_METHOD: Kinds = 1 << 4;
const INSTANCE_VARIABLE: Kinds = 1 << 5;
const INSTANCE_METHOD: Kinds = 1 << 6;

enum Group {
    Kind(Kinds),
    RegExp(Box<Regex>),
    Name(Box<[u8]>),
}

impl Group {
    /// The error is what `new RegExp(..)` throws.
    fn new(group: &[u8]) -> Result<Group, SyntaxError> {
        let has_slash = strings::contains_char(group, b'/');
        Ok(match group {
            b"getters" => Group::Kind(GETTER),
            b"setters" => Group::Kind(SETTER),
            b"type-annotations" => Group::Kind(TYPE_ANNOTATION),
            b"static-variables" => Group::Kind(STATIC_VARIABLE),
            b"static-methods" => Group::Kind(STATIC_METHOD),
            b"instance-variables" => Group::Kind(INSTANCE_VARIABLE),
            b"instance-methods" => Group::Kind(INSTANCE_METHOD),
            _ => match has_slash.then(|| REG_EXP_REG_EXP.exec_at(group, 0)).flatten() {
                Some(found) => Group::RegExp(Box::new(Regex::from_bytes(found.bytes(1), found.bytes(2))?)),
                None => Group::Name(group.into()),
            },
        })
    }
}

/// The first and the last of what upstream's `getRefPropIndexes` returns: those between them decide nothing.
#[derive(Copy, Clone, PartialEq, Eq)]
struct RefPropIndexes {
    first: u32,
    last: u32,
}

struct PropertyInfo<'a> {
    node: Property<'a>,
    name: Option<&'a [u8]>,
    indexes: RefPropIndexes,
    /// Which of the [`Alike`] it is one of.
    alike: usize,
}

/// The properties of a component that have the same indexes: each is as right or as wrong beside another as the others.
struct Alike {
    indexes: RefPropIndexes,
    count: u64,
    /// Where the last of them is.
    last: usize,
    /// The same for those before the property that is looked at.
    count_before: u64,
    last_before: usize,
}

/// A value of upstream's `errors`, whose key is where it is in the list.
#[derive(Copy, Clone)]
struct Error<'a> {
    node: Property<'a>,
    name: Option<&'a [u8]>,
    score: u64,
    distance: u32,
    ref_name: Option<&'a [u8]>,
    ref_index: u32,
}

struct MethodsOrder {
    groups: Vec<Group>,
    /// `methodsOrder.indexOf("everything-else")`, or [`MethodsOrder::infinity`].
    everything_else: u32,
}

impl MethodsOrder {
    /// upstream's `getMethodsOrder`
    fn new(user_config: Object<'_>) -> Result<MethodsOrder, SyntaxError> {
        let user_groups = user_config.object("groups");
        let order = match user_config.has("order") {
            true => user_config.strings("order"),
            false => DEFAULT_ORDER.to_vec(),
        };
        let mut groups = Vec::new();
        let mut everything_else = None;
        for entry in order {
            let config = match entry {
                _ if user_groups.has(entry) => user_groups.strings(entry),
                "lifecycle" => LIFECYCLE.to_vec(),
                _ => vec![entry],
            };
            for group in config {
                if group == "everything-else" && everything_else.is_none() {
                    everything_else = Some(groups.len() as u32);
                }
                groups.push(Group::new(group.as_bytes())?);
            }
        }
        let infinity = groups.len() as u32;
        Ok(MethodsOrder { groups, everything_else: everything_else.unwrap_or(infinity) })
    }

    /// What stands for `Infinity` among the indexes.
    fn infinity(&self) -> u32 {
        self.groups.len() as u32
    }

    /// `Math.abs(a - b)`, for two that are not the same.
    fn distance(&self, a: u32, b: u32) -> u32 {
        if a.max(b) == self.infinity() { u32::MAX } else { a.abs_diff(b) }
    }

    /// upstream's `getRefPropIndexes`
    fn get_ref_prop_indexes(&self, name: Option<&[u8]>, kinds: Kinds) -> RefPropIndexes {
        let mut indexes: Option<RefPropIndexes> = None;
        for (group_index, current_group) in self.groups.iter().enumerate() {
            let is_matching = match current_group {
                Group::Kind(kind) => kinds & kind != 0,
                Group::RegExp(regex) => regex.test(name.unwrap_or(b"undefined")),
                Group::Name(group) => name.is_some_and(|it| *it == **group),
            };
            if is_matching {
                let last = group_index as u32;
                indexes = Some(RefPropIndexes { first: indexes.map_or(last, |it| it.first), last });
            }
        }
        indexes.unwrap_or(RefPropIndexes { first: self.everything_else, last: self.everything_else })
    }

    fn indexes_of(&self, node: Property<'_>) -> RefPropIndexes {
        let kinds = kinds_of(node);
        self.get_ref_prop_indexes(get_property_name(node, kinds), kinds)
    }

    /// upstream's `checkPropsOrder`, which compares each property with each other. Two are in the wrong order if all
    /// indexes of the one that comes first are higher than all of the other.
    fn check_props_order<'a>(&self, properties: &[Property<'a>], errors: &mut [Option<Error<'a>>]) {
        let mut all_alike: Vec<Alike> = Vec::new();
        let mut properties_infos = Vec::with_capacity(properties.len());
        for (i, &node) in properties.iter().enumerate() {
            let kinds = kinds_of(node);
            let name = get_property_name(node, kinds);
            let indexes = self.get_ref_prop_indexes(name, kinds);
            let known = all_alike.iter().position(|it| it.indexes == indexes);
            let next = all_alike.len();
            let alike = known.unwrap_or(next);
            if known.is_none() {
                all_alike.push(Alike { indexes, count: 0, last: i, count_before: 0, last_before: i });
            }
            if let Some(it) = all_alike.get_mut(alike) {
                it.count += 1;
                it.last = i;
            }
            properties_infos.push(PropertyInfo { node, name, indexes, alike });
        }
        for (i, prop_a) in properties_infos.iter().enumerate() {
            let index_a = prop_a.indexes.last;
            let mut score = 0;
            // The last of those that upstream's `storeError` finds no farther than any before it.
            let mut closest: Option<(u32, usize)> = None;
            for it in &all_alike {
                let (count, k) = if it.indexes.first > index_a {
                    (it.count_before, it.last_before)
                } else if it.indexes.last < prop_a.indexes.first {
                    (it.count - it.count_before, it.last)
                } else {
                    continue;
                };
                let distance = self.distance(index_a, it.indexes.last);
                if count > 0 && closest.is_none_or(|(least, at)| distance < least || (distance == least && k > at)) {
                    closest = Some((distance, k));
                }
                score += count;
            }
            if let Some(it) = all_alike.get_mut(prop_a.alike) {
                it.count_before += 1;
                it.last_before = i;
            }
            let Some((distance, k)) = closest else { continue };
            let (Some(prop_b), Some(error)) = (properties_infos.get(k), errors.get_mut(index_a as usize)) else {
                continue;
            };
            let error = error.get_or_insert(Error {
                node: prop_a.node,
                name: prop_a.name,
                score: 0,
                distance: u32::MAX,
                ref_name: None,
                ref_index: 0,
            });
            error.score += score;
            if error.name == prop_a.name && distance <= error.distance {
                error.distance = distance;
                error.ref_name = prop_b.name;
                error.ref_index = prop_b.indexes.last;
            }
        }
    }
}

fn kinds_of(node: Property<'_>) -> Kinds {
    let member = match node {
        Property::Member(member) => member,
        Property::Prop(prop) => {
            return match prop.kind() {
                PropKind::Getter => GETTER,
                PropKind::Setter => SETTER,
                _ => 0,
            };
        }
    };
    let kinds = match member.kind() {
        MemberKind::Getter => GETTER,
        MemberKind::Setter => SETTER,
        // Also of an `accessor`, and of what is `abstract`.
        MemberKind::Property if member.ty().is_some() && member.init().is_none() => TYPE_ANNOTATION,
        _ => 0,
    };
    let is_function = node.func().is_some();
    if ast_utils::is_property_definition(member) {
        return kinds
            | match (node.is_static(), is_function) {
                (true, true) => STATIC_METHOD,
                (true, false) => STATIC_VARIABLE,
                (false, true) => INSTANCE_METHOD,
                (false, false) => INSTANCE_VARIABLE,
            };
    }
    let is_method_definition = member.kind() != MemberKind::Property && !member.flags().contains(Flags::ABSTRACT);
    if is_method_definition && is_function && node.is_static() { kinds | STATIC_METHOD } else { kinds }
}

/// upstream's `getPropertyName`. `None`: `undefined`, which is the `name` of a key that is no identifier.
fn get_property_name(node: Property<'_>, kinds: Kinds) -> Option<&[u8]> {
    if kinds & GETTER != 0 {
        return Some(&b"getter functions"[..]);
    }
    if kinds & SETTER != 0 {
        return Some(&b"setter functions"[..]);
    }
    let has_key = || node.key().is_some() || matches!(node, Property::Member(it) if it.constructor_keyword().is_some());
    node.name().or_else(|| (!has_key()).then_some(&b""[..]))
}

impl Rule for SortComp {
    const META: Meta = Meta::plugin(Plugin::React, "sort-comp", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new().classes().finish();
    /// Whether something that can be a component is out of order: few files need the components.
    type State<'a> = bool;

    fn new(options: &Options) -> Self {
        SortComp { methods_order: MethodsOrder::new(options.object(0)).ok() }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        MethodsOrder::new(options.object(0)).map(|_| ()).map_err(|error| error.message.into_bytes())
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<bool> {
        self.methods_order.as_ref()?;
        // The object literals are not looked at before the components are known.
        let creates_classes = mentions_create_class(file, get_create_class_from_context(file));
        ((file.has_classes() || creates_classes) && Components::may_have_any(file)).then_some(creates_classes)
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let Some(methods_order) = self.methods_order.as_ref().filter(|_| !cx.state) else { return };
        let mut highest = 0;
        for member in class.members().iter() {
            let indexes = methods_order.indexes_of(Property::Member(member));
            cx.state = cx.state || highest > indexes.last;
            highest = highest.max(indexes.first);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let Some(methods_order) = self.methods_order.as_ref().filter(|_| cx.state) else { return };
        let mut components = Components::new(cx.file());
        components.finish();
        // One for all components, as upstream has it.
        let mut errors = vec![None; methods_order.groups.len() + 1];
        for id in components.list() {
            let properties = get_component_properties(components.component(id).node);
            methods_order.check_props_order(&properties, &mut errors);
        }
        // upstream's `dedupeErrors`. It goes through all that there were at first.
        for (i, error) in errors.clone().iter().enumerate() {
            let Some(error) = error else { continue };
            let index = error.ref_index as usize;
            let Some(Some(other)) = errors.get(index) else { continue };
            let deleted = if error.score > other.score { index } else { i };
            if let Some(it) = errors.get_mut(deleted) {
                *it = None;
            }
        }
        for (index_a, error) in errors.iter().enumerate() {
            let Some(error) = error else { continue };
            cx.report(error.node.node(), UNSORTED_PROPS)
                .data("propA", error.name.unwrap_or(b"undefined"))
                .data("propB", error.ref_name.unwrap_or(b"undefined"))
                .data("position", if (index_a as u32) < error.ref_index { "before" } else { "after" });
        }
    }
}
