//! `class Components` from eslint-plugin-react's `lib/util/Components.js`: the list of a file's
//! components. Nothing here detects one.
//!
//! Also here, for the engine that fills the list:
//!
//! - what `propTypes.js`, `usedPropTypes.js` and `defaultProps.js` store in a component,
//! - [`At`], the clock: upstream both fills and reads the list while ESLint walks the tree,
//! - [`Queue`]: the pending work, in the order of that walk.
//!
//! `getDefaultReactImports`, `getNamedReactImports` and the two functions that add to them have one
//! user, `hook-use-state`, which reads the imports itself.

use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_parent, estree_span, normalize, sort};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

// ───────────────────────────── the clock ─────────────────────────────

/// A point in ESLint's walk: entering or leaving a node that has text. They sort in walk order.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct At(u128);

impl At {
    /// `Program:exit`
    pub(crate) const END: At = At(u128::MAX);

    /// Of nodes that start together, the longer one is entered first. Of nodes with the same range,
    /// the outer one.
    pub(crate) fn enter(node: Node<'_>) -> At {
        let (span, depth) = At::span_and_depth(node);
        At::new(2 * u64::from(span.start) + 1, u32::MAX - span.end, depth)
    }

    /// A node that ends where another starts is left before the other is entered.
    pub(crate) fn exit(node: Node<'_>) -> At {
        let (span, depth) = At::span_and_depth(node);
        At::new(
            2 * u64::from(span.end),
            u32::MAX - span.start,
            u8::MAX - depth,
        )
    }

    /// True if [`At::exit`] made it.
    pub(crate) fn is_exit(self) -> bool {
        ((self.0 >> 40) & 1) == 0
    }

    fn new(position: u64, tie_break: u32, depth: u8) -> At {
        At((u128::from(position) << 40) | (u128::from(tie_break) << 8) | u128::from(depth))
    }

    /// The range the walk spends inside `node`, and `node`'s depth among nodes with the same range.
    fn span_and_depth(node: Node<'_>) -> (Span, u8) {
        let node = normalize(node);
        let span = match node {
            // ESLint visits decorators as the node's children, even the ones before the node's range.
            Node::Class(class) => class.span(),
            Node::Param(param) => param.span(),
            _ => estree_span(node),
        };
        let depth = match node {
            Node::File(_) => 0,
            Node::Stmt(_) => 1,
            Node::Type(_) | Node::Expr(_) => 3,
            Node::Class(_) | Node::Func(_) => 4,
            Node::Pat(_) => 5,
            _ => 2,
        };
        (span, depth)
    }
}

// ───────────────────────────── the queue ─────────────────────────────

/// An item popped from a [`Queue`].
#[derive(Copy, Clone)]
pub(crate) struct Event<'a> {
    pub(crate) at: At,
    pub(crate) rank: u8,
    pub(crate) node: Node<'a>,
}

/// Nodes waiting for a listener call, each with the point in the walk when it's due.
#[derive(Default)]
pub(crate) struct Queue<'a> {
    events: Vec<Event<'a>>,
    /// Number of `events` already popped.
    popped: usize,
    is_sorted: bool,
}

impl<'a> Queue<'a> {
    /// Among events due at the same point, the lower `rank` comes first, like the earlier rule
    /// passed to upstream's `mergeRules`. Within a rank, events keep their push order.
    pub(crate) fn push(&mut self, at: At, rank: u8, node: Node<'a>) {
        self.events.push(Event { at, rank, node });
        self.is_sorted = false;
    }

    /// Pops the next event due at or before `at`. Sorts first if there was a `push` since the last call.
    pub(crate) fn pop_until(&mut self, at: At) -> Option<Event<'a>> {
        if !self.is_sorted {
            let waiting = self.events.get_mut(self.popped..)?;
            sort::sort_by_key(waiting, |it| (it.at, it.rank));
            self.is_sorted = true;
        }
        let &next = self.events.get(self.popped)?;
        if next.at > at {
            return None;
        }
        self.popped += 1;
        Some(next)
    }
}

// ───────────────────────────── what the stages store ─────────────────────────────

/// `type` of a declared prop type.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum PropTypeKind {
    Shape,
    Exact,
    Object,
    Union,
}

/// `children` of a declared prop type.
#[derive(Clone, Default)]
pub(crate) enum Children<'a> {
    #[default]
    None,
    Named(DeclaredPropTypes<'a>),
    Union(Vec<DeclaredPropType<'a>>),
}

/// The result of `buildReactDeclarationTypes` and `DeclarePropTypesForTSTypeAnnotation`. The
/// default is `{}`, which accepts everything.
#[derive(Clone, Default)]
pub(crate) struct DeclaredPropType<'a> {
    pub(crate) kind: Option<PropTypeKind>,
    pub(crate) children: Children<'a>,
    pub(crate) full_name: Option<Cow<'a, [u8]>>,
    pub(crate) name: Option<Cow<'a, [u8]>>,
    pub(crate) node: Option<Node<'a>>,
    pub(crate) is_required: Option<bool>,
}

/// `declaredPropTypes`, or a shape's `children`. Upstream uses a plain JavaScript object. This only
/// has own properties, while `object[name]` also finds `Object.prototype`'s.
#[derive(Clone, Default)]
pub(crate) struct DeclaredPropTypes<'a> {
    /// In insertion order.
    entries: Vec<(Cow<'a, [u8]>, DeclaredPropType<'a>)>,
    /// Index into `entries` by name, once there are more than [`DeclaredPropTypes::FEW`].
    index: FxHashMap<Cow<'a, [u8]>, u32>,
    /// The value assigned to `__proto__`, which doesn't create a property. Lookups through the
    /// prototype aren't modeled.
    prototype: Option<Box<DeclaredPropType<'a>>>,
}

impl<'a> DeclaredPropTypes<'a> {
    const FEW: usize = 8;

    /// `name` as a number, if it's an ECMAScript array index.
    fn integer(name: &[u8]) -> Option<u32> {
        let is_canonical =
            name.iter().all(u8::is_ascii_digit) && (name.len() == 1 || !name.starts_with(b"0"));
        bun_core::fmt::parse_decimal::<u32>(name).filter(|&it| is_canonical && it != u32::MAX)
    }

    fn position(&self, name: &[u8]) -> Option<usize> {
        if self.entries.len() <= DeclaredPropTypes::FEW {
            return self.entries.iter().position(|(it, _)| &**it == name);
        }
        self.index.get(name).map(|&at| at as usize)
    }

    pub(crate) fn get(&self, name: &[u8]) -> Option<&DeclaredPropType<'a>> {
        if name == b"__proto__" {
            return self.prototype.as_deref();
        }
        Some(&self.entries.get(self.position(name)?)?.1)
    }

    pub(crate) fn get_mut(&mut self, name: &[u8]) -> Option<&mut DeclaredPropType<'a>> {
        if name == b"__proto__" {
            return self.prototype.as_deref_mut();
        }
        let at = self.position(name)?;
        Some(&mut self.entries.get_mut(at)?.1)
    }

    /// `object[name] = value`. An existing name keeps its position.
    pub(crate) fn insert(&mut self, name: Cow<'a, [u8]>, value: DeclaredPropType<'a>) {
        if *name == *b"__proto__" {
            self.prototype = Some(Box::new(value));
            return;
        }
        if let Some(old) = self.get_mut(&name) {
            *old = value;
            return;
        }
        let at = self.entries.len();
        if at == DeclaredPropTypes::FEW {
            let names = self.entries.iter().map(|(it, _)| it.clone());
            self.index.extend(names.zip(0u32..));
        }
        if at >= DeclaredPropTypes::FEW {
            self.index.insert(name.clone(), at as u32);
        }
        self.entries.push((name, value));
    }

    /// In `Object.keys` order: array indices ascending, then the rest in insertion order.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (&[u8], &DeclaredPropType<'a>)> {
        let entries = &self.entries;
        let numbers = entries.iter().map(|(it, _)| DeclaredPropTypes::integer(it));
        let numbered = numbers.zip(0u32..).filter_map(|(it, at)| Some((it?, at)));
        let mut integers: Vec<(u32, u32)> = numbered.collect();
        sort::sort_unstable(&mut integers);
        let first = integers
            .into_iter()
            .filter_map(move |(_, at)| entries.get(at as usize));
        let others = entries
            .iter()
            .filter(|(it, _)| DeclaredPropTypes::integer(it).is_none());
        first.chain(others).map(|(name, value)| (&**name, value))
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// An element of `usedPropTypes`.
#[derive(Clone)]
pub(crate) struct UsedPropType<'a> {
    pub(crate) name: &'a [u8],
    /// `typeof name !== "string"`: a pattern's key `1`, as opposed to the `"1"` of `props[1]`.
    pub(crate) is_number: bool,
    pub(crate) all_names: SmallVec<[&'a [u8]; 2]>,
    /// The range of `node`.
    pub(crate) at: Span,
    /// `node.kind === "init"`
    pub(crate) is_property: bool,
}

impl<'a> UsedPropType<'a> {
    /// The key upstream's `usedPropTypesAreEquivalent` compares: `name` and `allNames.join("")`.
    fn equivalence(&self) -> (&'a [u8], bool, Cow<'a, [u8]>) {
        let all_names = match self.all_names.as_slice() {
            [only] => Cow::Borrowed(*only),
            all_names => Cow::Owned(all_names.concat()),
        };
        (self.name, self.is_number, all_names)
    }
}

/// The set of used prop types in a list. The list is append-only.
#[derive(Default)]
struct Equivalents<'a> {
    known: FxHashSet<(&'a [u8], bool, Cow<'a, [u8]>)>,
    /// Number of the list's items that are in `known`.
    counted: usize,
}

impl<'a> Equivalents<'a> {
    /// Upstream's `mergeUsedPropTypes`. `props_list` becomes its return value. If two of the new
    /// ones are equivalent, both are added.
    fn merge_used_prop_types(
        &mut self,
        props_list: &mut Vec<UsedPropType<'a>>,
        new_props_list: &mut dyn Iterator<Item = UsedPropType<'a>>,
    ) {
        let uncounted = props_list.iter().skip(self.counted);
        self.known.extend(uncounted.map(UsedPropType::equivalence));
        self.counted = props_list.len();
        props_list.extend(new_props_list.filter(|it| !self.known.contains(&it.equivalence())));
    }
}

/// A component's `defaultProps`: `"unresolved"`, or each name's node in `Object.keys` order.
#[derive(Clone)]
pub(crate) enum DefaultProps<'a> {
    Unresolved,
    Known(Vec<(Cow<'a, [u8]>, Node<'a>)>),
}

// ───────────────────────────── the list ─────────────────────────────

/// Identifies a component in a [`ComponentList`] by its insertion index.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(crate) struct ComponentId(u32);

/// A value of upstream's list.
pub(crate) struct Component<'a> {
    /// [`normalize`]d.
    pub(crate) node: Node<'a>,
    /// 0: banned, 1: maybe, 2: yes.
    pub(crate) confidence: u8,
    pub(crate) declared_prop_types: Option<DeclaredPropTypes<'a>>,
    pub(crate) ignore_props_validation: bool,
    /// Append-only. See [`Component::merge_used_prop_types`].
    pub(crate) used_prop_types: Option<Vec<UsedPropType<'a>>>,
    pub(crate) ignore_unused_prop_types_validation: bool,
    pub(crate) default_props: Option<DefaultProps<'a>>,
    equivalents: Equivalents<'a>,
}

impl<'a> Component<'a> {
    /// `component.node.range`
    pub(crate) fn span(&self) -> Span {
        estree_span(self.node)
    }

    /// `component.usedPropTypes = mergeUsedPropTypes(component.usedPropTypes || [], newPropsList)`,
    /// which is what `components.set(node, { usedPropTypes: newPropsList })` does to it.
    pub(crate) fn merge_used_prop_types(&mut self, new_props_list: Vec<UsedPropType<'a>>) {
        let props_list = self.used_prop_types.get_or_insert_default();
        self.equivalents
            .merge_used_prop_types(props_list, &mut new_props_list.into_iter());
    }
}

/// Upstream's `getId`. A node is identified by its range.
fn get_id(node: Node<'_>) -> Span {
    estree_span(normalize(node))
}

/// True if ESTree has a `Decorator` between `child` and its `parent`.
fn is_in_decorator<'a>(child: Node<'a>, parent: Node<'a>) -> bool {
    let modifiers = match parent {
        Node::Class(class) => class.modifiers(),
        Node::Member(member) => member.modifiers(),
        Node::Param(param) => param.modifiers(),
        _ => return false,
    };
    // Everything else in these nodes comes after the keywords and decorators.
    let last = modifiers.last();
    last.is_some_and(|last| estree_span(child).start < last.span().end)
}

/// Upstream's `class Components`.
#[derive(Default)]
pub(crate) struct ComponentList<'a> {
    /// `Object.values(Lists.get(this))`
    list: Vec<Component<'a>>,
    by_id: FxHashMap<Span, ComponentId>,
    /// Cache for `set`: the component enclosing a node. It's reset when a node that could be on a
    /// cached path becomes a component or stops being one.
    enclosing_cache: AncestorMemo<'a, ComponentId>,
    /// The highest start of any node looked up in `enclosing_cache`.
    max_queried_start: u32,
}

impl<'a> ComponentList<'a> {
    /// Adds a node to the list, or updates it if it's already there. A confidence of 0 is permanent.
    pub(crate) fn add(&mut self, node: Node<'a>, confidence: u8) -> ComponentId {
        let known = self.by_id.get(&get_id(node)).copied();
        let (id, before, after) = match known {
            Some(id) => {
                let component = self.component_mut(id);
                let before = component.confidence;
                component.confidence = if confidence == 0 || before == 0 {
                    0
                } else {
                    before.max(confidence)
                };
                (id, before, component.confidence)
            }
            None => {
                let id = ComponentId(self.list.len() as u32);
                self.by_id.insert(get_id(node), id);
                self.list.push(Component {
                    node: normalize(node),
                    confidence,
                    declared_prop_types: None,
                    ignore_props_validation: false,
                    used_prop_types: None,
                    ignore_unused_prop_types_validation: false,
                    default_props: None,
                    equivalents: Equivalents::default(),
                });
                (id, 0, confidence)
            }
        };
        // A node that starts before `node` can't be inside it, so the cache stays valid for it.
        if (before >= 1) != (after >= 1)
            && At::span_and_depth(node).0.start <= self.max_queried_start
        {
            self.enclosing_cache = AncestorMemo::default();
            self.max_queried_start = 0;
        }
        id
    }

    /// `get` on the list's fields, for use while another field is borrowed.
    fn get_in(
        list: &[Component<'a>],
        by_id: &FxHashMap<Span, ComponentId>,
        node: Node<'a>,
    ) -> Option<ComponentId> {
        let &id = by_id.get(&get_id(node))?;
        let item = list.get(id.0 as usize)?;
        (item.confidence >= 1).then_some(id)
    }

    /// The component for `node`. `None` if it isn't in the list or is banned.
    pub(crate) fn get(&self, node: Node<'a>) -> Option<ComponentId> {
        ComponentList::get_in(&self.list, &self.by_id, node)
    }

    /// `set(node, {})`. Returns the first of `node` and its ancestors that's currently a component,
    /// which is where upstream assigns the properties. `None` if there's none, in which case
    /// upstream drops them.
    pub(crate) fn set(&mut self, node: Node<'a>) -> Option<ComponentId> {
        let (list, by_id) = (&self.list, &self.by_id);
        let id = ComponentList::get_in(list, by_id, node).or_else(|| {
            self.max_queried_start = self.max_queried_start.max(At::span_and_depth(node).0.start);
            self.enclosing_cache
                .find_with(normalize(node), estree_parent, |_, parent| {
                    ComponentList::get_in(list, by_id, parent)
                })
        })?;
        self.component_mut(id)
            .used_prop_types
            .get_or_insert_default();
        Some(id)
    }

    /// The components with full confidence, in insertion order. Like upstream, it also gives each
    /// of them the props used by the uncertain components inside it.
    pub(crate) fn list(&mut self) -> Vec<ComponentId> {
        let mut used_prop_types: FxHashMap<ComponentId, (Vec<UsedPropType<'a>>, Equivalents<'a>)> =
            FxHashMap::default();
        let mut enclosing_memo: AncestorMemo<'a, Option<ComponentId>> = AncestorMemo::default();

        // Find props used in components for which we are not confident
        for uncertain in self.list.iter().filter(|it| it.confidence < 2) {
            let component =
                enclosing_memo.find_with(uncertain.node, estree_parent, |child, parent| {
                    // Stop moving up if we reach a decorator
                    if is_in_decorator(child, parent) {
                        return Some(None);
                    }
                    self.get(parent).map(Some)
                });
            let Some(Some(component)) = component else {
                continue;
            };
            let used = uncertain.used_prop_types.iter().flatten();
            let mut new_used_props = used.filter(|it| !it.is_property).cloned();
            let (props_list, equivalents) = used_prop_types.entry(component).or_default();
            equivalents.merge_used_prop_types(props_list, &mut new_used_props);
        }

        // Assign used props in not confident components to the parent component
        let mut list = Vec::new();
        for (component, id) in self.list.iter_mut().zip(0u32..) {
            if component.confidence < 2 {
                continue;
            }
            list.push(ComponentId(id));
            if let Some((new_props_list, _)) = used_prop_types.remove(&ComponentId(id)) {
                component.merge_used_prop_types(new_props_list);
            }
        }
        list
    }

    /// Number of components with full confidence.
    pub(crate) fn length(&self) -> usize {
        self.list.iter().filter(|it| it.confidence >= 2).count()
    }

    pub(crate) fn component(&self, id: ComponentId) -> &Component<'a> {
        &self.list[id.0 as usize]
    }

    pub(crate) fn component_mut(&mut self, id: ComponentId) -> &mut Component<'a> {
        &mut self.list[id.0 as usize]
    }
}
