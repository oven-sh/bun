#![allow(dead_code)] // until every rule of the plugin is written
//! `class Components` of `lib/util/Components.js` of eslint-plugin-react: the list of the
//! components of a file. Nothing here detects one.
//!
//! Beside it, for the engine that fills the list:
//!
//! - what `propTypes.js`, `usedPropTypes.js` and `defaultProps.js` store in a component,
//! - [`At`], the clock: upstream fills the list while ESLint walks the tree, and reads it then,
//! - [`Queue`]: what is to be done, in the order of that walk.
//!
//! `getDefaultReactImports`, `getNamedReactImports` and the two that add to them have one reader,
//! `hook-use-state`, which asks the imports itself.

use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_parent, estree_span, normalize, sort};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

// ───────────────────────────── the clock ─────────────────────────────

/// A moment of ESLint's walk: it enters or leaves a node that has text. They are ordered as the
/// walk is.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct At(u128);

impl At {
    /// `Program:exit`
    pub(crate) const END: At = At(u128::MAX);

    /// Of the nodes that start together the longer is entered first, of those with one range the
    /// outer.
    pub(crate) fn enter(node: Node<'_>) -> At {
        let (span, depth) = At::place(node);
        At::new(2 * u64::from(span.start) + 1, u32::MAX - span.end, depth)
    }

    /// What ends where another node starts is left before that is entered.
    pub(crate) fn exit(node: Node<'_>) -> At {
        let (span, depth) = At::place(node);
        At::new(
            2 * u64::from(span.end),
            u32::MAX - span.start,
            u8::MAX - depth,
        )
    }

    /// Whether it is made by [`At::exit`].
    pub(crate) fn is_exit(self) -> bool {
        ((self.0 >> 40) & 1) == 0
    }

    fn new(position: u64, among_equals: u32, depth: u8) -> At {
        At((u128::from(position) << 40) | (u128::from(among_equals) << 8) | u128::from(depth))
    }

    /// From where to where the walk is in `node`, and how far in among the nodes with that range.
    fn place(node: Node<'_>) -> (Span, u8) {
        let node = normalize(node);
        let span = match node {
            // ESLint gets to the decorators from the node, to those before its range too.
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

/// What a [`Queue`] hands out.
#[derive(Copy, Clone)]
pub(crate) struct Event<'a> {
    pub(crate) at: At,
    pub(crate) rank: u8,
    pub(crate) node: Node<'a>,
}

/// The nodes that somebody wants to be called with, each at its time.
#[derive(Default)]
pub(crate) struct Queue<'a> {
    events: Vec<Event<'a>>,
    /// How many of `events` are handed out.
    popped: usize,
    is_sorted: bool,
}

impl<'a> Queue<'a> {
    /// Of what is due at one moment the lower `rank` comes first, as the earlier of the rules that
    /// upstream's `mergeRules` is given. Of one rank: what is pushed first.
    pub(crate) fn push(&mut self, at: At, rank: u8, node: Node<'a>) {
        self.events.push(Event { at, rank, node });
        self.is_sorted = false;
    }

    /// The next that is due at `at` or before. It sorts when it is called after a `push`.
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

/// What `buildReactDeclarationTypes` and `DeclarePropTypesForTSTypeAnnotation` make. The default is
/// `{}`, which accepts everything.
#[derive(Clone, Default)]
pub(crate) struct DeclaredPropType<'a> {
    pub(crate) kind: Option<PropTypeKind>,
    pub(crate) children: Children<'a>,
    pub(crate) full_name: Option<Cow<'a, [u8]>>,
    pub(crate) name: Option<Cow<'a, [u8]>>,
    pub(crate) node: Option<Node<'a>>,
    pub(crate) is_required: Option<bool>,
}

/// `declaredPropTypes`, and the `children` of a shape: an object of JavaScript. It has its own
/// properties only: `object[name]` also finds what `Object.prototype` has.
#[derive(Clone, Default)]
pub(crate) struct DeclaredPropTypes<'a> {
    /// As they came.
    entries: Vec<(Cow<'a, [u8]>, DeclaredPropType<'a>)>,
    /// The index into `entries` by the name, once there are more than [`DeclaredPropTypes::FEW`].
    index: FxHashMap<Cow<'a, [u8]>, u32>,
}

impl<'a> DeclaredPropTypes<'a> {
    const FEW: usize = 8;

    /// The number that `name` is, if it is an array index of ECMAScript.
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
        Some(&self.entries.get(self.position(name)?)?.1)
    }

    pub(crate) fn get_mut(&mut self, name: &[u8]) -> Option<&mut DeclaredPropType<'a>> {
        let at = self.position(name)?;
        Some(&mut self.entries.get_mut(at)?.1)
    }

    /// `object[name] = value`: a name that is there keeps its place.
    pub(crate) fn insert(&mut self, name: Cow<'a, [u8]>, value: DeclaredPropType<'a>) {
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

    /// In the order of `Object.keys`: the array indices, ascending, then the others as they came.
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
    pub(crate) all_names: SmallVec<[&'a [u8]; 2]>,
    /// The range of `node`.
    pub(crate) at: Span,
    /// `node.kind === "init"`
    pub(crate) is_property: bool,
}

impl<'a> UsedPropType<'a> {
    /// What upstream's `usedPropTypesAreEquivalent` compares: `name` and `allNames.join("")`.
    fn equivalence(&self) -> (&'a [u8], Cow<'a, [u8]>) {
        let all_names = match self.all_names.as_slice() {
            [only] => Cow::Borrowed(*only),
            all_names => Cow::Owned(all_names.concat()),
        };
        (self.name, all_names)
    }
}

/// Which used prop types a list has. The list is only added to.
#[derive(Default)]
struct Equivalents<'a> {
    known: FxHashSet<(&'a [u8], Cow<'a, [u8]>)>,
    /// How many of the list are in `known`.
    counted: usize,
}

impl<'a> Equivalents<'a> {
    /// upstream's `mergeUsedPropTypes`: `props_list` becomes what that returns. Two of the new ones
    /// that are equivalent are both added.
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

/// `defaultProps` of a component: `"unresolved"`, or the node by the name, in the order of
/// `Object.keys`.
#[derive(Clone)]
pub(crate) enum DefaultProps<'a> {
    Unresolved,
    Known(Vec<(Cow<'a, [u8]>, Node<'a>)>),
}

// ───────────────────────────── the list ─────────────────────────────

/// Which component of a [`ComponentList`]: the how manyth that was added.
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
    /// To be pushed to, and never made shorter: see [`Component::merge_used_prop_types`].
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

/// upstream's `getId`: a node is known by its range.
fn get_id(node: Node<'_>) -> Span {
    estree_span(normalize(node))
}

/// Whether ESTree has a `Decorator` between `child` and its `parent`.
fn is_in_decorator<'a>(child: Node<'a>, parent: Node<'a>) -> bool {
    let modifiers = match parent {
        Node::Class(class) => class.modifiers(),
        Node::Member(member) => member.modifiers(),
        Node::Param(param) => param.modifiers(),
        _ => return false,
    };
    // All else that is in these comes after the keywords and the decorators.
    let last = modifiers.last();
    last.is_some_and(|last| estree_span(child).start < last.span().end)
}

/// upstream's `class Components`.
#[derive(Default)]
pub(crate) struct ComponentList<'a> {
    /// `Object.values(Lists.get(this))`
    list: Vec<Component<'a>>,
    by_id: FxHashMap<Span, ComponentId>,
    /// For `set`: the component around a node, until another node becomes one or ceases to be one.
    around: AncestorMemo<'a, ComponentId>,
}

impl<'a> ComponentList<'a> {
    /// Adds a node to the list, or updates it if it is there. A confidence of 0 stays.
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
        if (before >= 1) != (after >= 1) {
            self.around = AncestorMemo::default();
        }
        id
    }

    /// `get` on the parts of a list, for while another part is borrowed.
    fn get_in(
        list: &[Component<'a>],
        by_id: &FxHashMap<Span, ComponentId>,
        node: Node<'a>,
    ) -> Option<ComponentId> {
        let &id = by_id.get(&get_id(node))?;
        let item = list.get(id.0 as usize)?;
        (item.confidence >= 1).then_some(id)
    }

    /// The component that `node` is. `None` if it is not in the list, or banned.
    pub(crate) fn get(&self, node: Node<'a>) -> Option<ComponentId> {
        ComponentList::get_in(&self.list, &self.by_id, node)
    }

    /// `set(node, {})`: the first of `node` and its ancestors that is a component now: upstream
    /// assigns the properties to it. `None`: there is none, and upstream drops them.
    pub(crate) fn set(&mut self, node: Node<'a>) -> Option<ComponentId> {
        let (list, by_id) = (&self.list, &self.by_id);
        let id = ComponentList::get_in(list, by_id, node).or_else(|| {
            self.around
                .find_with(normalize(node), estree_parent, |_, parent| {
                    ComponentList::get_in(list, by_id, parent)
                })
        })?;
        self.component_mut(id)
            .used_prop_types
            .get_or_insert_default();
        Some(id)
    }

    /// The components that are certain, as they were added. As upstream, it gives each of them
    /// what the uncertain ones in it use.
    pub(crate) fn list(&mut self) -> Vec<ComponentId> {
        let mut used_prop_types: FxHashMap<ComponentId, (Vec<UsedPropType<'a>>, Equivalents<'a>)> =
            FxHashMap::default();
        let mut around: AncestorMemo<'a, Option<ComponentId>> = AncestorMemo::default();

        // Find props used in components for which we are not confident
        for uncertain in self.list.iter().filter(|it| it.confidence < 2) {
            let component = around.find_with(uncertain.node, estree_parent, |child, parent| {
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

    /// How many components are certain.
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
