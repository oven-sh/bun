use super::inputs::{
    DefinePath, DefineRoot, DefineValue, DropReach, FoldInputs, FoldOptions, LinkForm, PathState,
    TrieNode,
};
use super::{Constant, slice_in};
use crate::atom::{Atom, known};
use crate::session::Arena;

impl<'s> FoldInputs<'s> {
    #[allow(clippy::large_types_passed_by_value)] // made for this call
    pub fn new(options: FoldOptions<'s>, arena: &'s Arena) -> FoldInputs<'s> {
        let mut trie = TrieBuilder::default();
        for define in options.defines {
            trie.ensure_path(define.path).value = Some(define.value);
        }
        for &path in options.plain_path_defines {
            trie.ensure_path(path).is_plain_path_only = true;
        }
        for &path in options.dropped_calls {
            trie.ensure_path(path).ends_dropped_path = true;
        }
        let nodes: Vec<TrieNode<'s>> = trie
            .nodes
            .iter()
            .map(|node| TrieNode {
                edges: slice_in(&node.edges, arena),
                value: node.value,
                is_plain_path_only: node.is_plain_path_only,
                ends_dropped_path: node.ends_dropped_path,
            })
            .collect();
        let root_filter = trie.roots.iter().fold(0, |filter, entry| match entry.0 {
            DefineRoot::Global(name) => filter | root_filter_bit(name),
            DefineRoot::ImportMeta => filter,
        });
        FoldInputs {
            nodes: slice_in(&nodes, arena),
            roots: slice_in(&trie.roots, arena),
            root_filter,
            has_dropped_paths: !options.dropped_calls.is_empty(),
            features: options.features,
            preserves_unused_imports: options.preserves_unused_imports,
            minifies_syntax: options.minifies_syntax,
            max_string_bytes: options.max_string_bytes,
            is_called_before_it_runs: false,
        }
    }

    pub fn for_file_called_before_it_runs(self) -> FoldInputs<'s> {
        FoldInputs {
            is_called_before_it_runs: true,
            ..self
        }
    }

    #[inline]
    pub(super) fn is_empty(&self) -> bool {
        self.roots.is_empty()
    }

    #[inline]
    pub(super) fn root(&self, root: DefineRoot) -> Option<PathState> {
        let passes_filter = match root {
            DefineRoot::Global(name) => self.root_filter & root_filter_bit(name) != 0,
            DefineRoot::ImportMeta => true,
        };
        if !passes_filter {
            return None;
        }
        let node = find_node(self.roots, root)?;
        let drop = match self.nodes[node as usize].ends_dropped_path {
            true => DropReach::Whole,
            false => DropReach::None,
        };
        Some(PathState {
            node: Some(node),
            is_bound_root: false,
            has_optional_link: false,
            ends_with_index: false,
            drop,
            has_dynamic_root: false,
        })
    }

    // `bun build` takes `.name`, `["name"]` and either of them behind `?.` for the same step of a path.
    pub(super) fn child(&self, state: PathState, name: Atom, form: LinkForm) -> Option<PathState> {
        let parent = state.node;
        let node = parent.and_then(|parent| find_node(self.nodes[parent as usize].edges, name));
        let ends_dropped_path = !state.is_bound_root
            && node.is_some_and(|node| self.nodes[node as usize].ends_dropped_path);
        let path_end = match ends_dropped_path {
            true => DropReach::of_path_end(form.is_index),
            false => DropReach::None,
        };
        let drop = state.drop.behind_link(name, form.is_index).max(path_end);
        (node.is_some() || drop != DropReach::None).then_some(PathState {
            node,
            has_optional_link: state.has_optional_link || form.is_in_optional_chain,
            ends_with_index: form.is_index,
            drop,
            ..state
        })
    }

    /// The state of `object[key]` where the key is no text of the program: it is a step of no path.
    pub(super) fn computed_child(&self, state: PathState) -> Option<PathState> {
        let drop = state.drop.behind_link(Atom::NONE, true);
        (drop != DropReach::None).then_some(PathState {
            node: None,
            drop,
            ..state
        })
    }

    #[inline]
    pub(super) fn value_of(&self, state: PathState) -> Option<DefineValue<'s>> {
        let node = &self.nodes[state.node? as usize];
        let value = node.value?;
        let is_there_in_every_run = matches!(
            value,
            DefineValue::RuntimeValue(_) | DefineValue::RuntimeConstant(_)
        );
        let is_plain_path = !state.has_optional_link && !state.ends_with_index;
        let is_replaced = !state.is_bound_root && (is_plain_path || !node.is_plain_path_only);
        if !is_replaced && !is_there_in_every_run {
            return None;
        }
        match value {
            _ if is_there_in_every_run && state.has_dynamic_root => None,
            // `bun run` writes the name `NaN` for the global, and a define may have the number for another name.
            DefineValue::Constant(Constant::Number(number))
                if state.has_dynamic_root
                    && number.is_nan()
                    && state.node == find_node(self.roots, DefineRoot::Global(known::NaN)) =>
            {
                None
            }
            value => Some(value),
        }
    }

    pub(super) fn has_feature(&self, flag: Atom) -> bool {
        self.features.contains(&flag)
    }

    #[inline]
    pub(crate) fn preserves_unused_imports(&self) -> bool {
        self.preserves_unused_imports
    }

    #[inline]
    pub(crate) fn max_string_bytes(&self) -> usize {
        self.max_string_bytes
    }

    /// What a build knows `root.member` to be, where `root` is the global of that name.
    pub(crate) fn constant_of_member(&self, root: Atom, member: Atom) -> Option<Constant> {
        let root = self.root(DefineRoot::Global(root))?;
        match self.value_of(self.child(root, member, LinkForm::DOT)?)? {
            DefineValue::Constant(constant) | DefineValue::RuntimeConstant(constant) => {
                Some(constant)
            }
            DefineValue::GlobalPath(_) | DefineValue::Data(_) | DefineValue::RuntimeValue(_) => {
                None
            }
        }
    }
}

#[derive(Default)]
struct NodeBuilder<'s> {
    edges: Vec<(Atom, u32)>,
    value: Option<DefineValue<'s>>,
    is_plain_path_only: bool,
    ends_dropped_path: bool,
}

#[derive(Default)]
struct TrieBuilder<'s> {
    nodes: Vec<NodeBuilder<'s>>,
    roots: Vec<(DefineRoot, u32)>,
}

impl<'s> TrieBuilder<'s> {
    fn add_node(&mut self) -> u32 {
        let node = self.nodes.len() as u32;
        self.nodes.push(NodeBuilder::default());
        node
    }

    fn ensure_root(&mut self, root: DefineRoot) -> u32 {
        if let Some(node) = find_node(&self.roots, root) {
            return node;
        }
        let node = self.add_node();
        self.roots.push((root, node));
        node
    }

    fn ensure_child(&mut self, parent: u32, name: Atom) -> u32 {
        if let Some(node) = find_node(&self.nodes[parent as usize].edges, name) {
            return node;
        }
        let node = self.add_node();
        self.nodes[parent as usize].edges.push((name, node));
        node
    }

    fn ensure_path(&mut self, path: DefinePath<'_>) -> &mut NodeBuilder<'s> {
        let mut node = self.ensure_root(path.root);
        for &member in path.members {
            node = self.ensure_child(node, member);
        }
        &mut self.nodes[node as usize]
    }
}

fn find_node<K: Copy + PartialEq>(entries: &[(K, u32)], key: K) -> Option<u32> {
    let entry = entries.iter().find(|entry| entry.0 == key)?;
    Some(entry.1)
}

#[inline]
fn root_filter_bit(name: Atom) -> u64 {
    1 << (name.0 & 63)
}

#[cfg(test)]
mod tests;
