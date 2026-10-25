use super::inputs::{
    DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions, PathState, TrieNode,
};
use super::{Constant, slice_in};
use crate::atom::Atom;
use crate::session::Arena;

impl<'s> FoldInputs<'s> {
    #[allow(clippy::large_types_passed_by_value)] // made for this call
    pub fn new(options: FoldOptions<'s>, arena: &'s Arena) -> FoldInputs<'s> {
        let mut trie = TrieBuilder::default();
        for define in options.defines {
            trie.ensure_path(define.path).value = Some(define.value);
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
            features: options.features,
            preserves_unused_imports: options.preserves_unused_imports,
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
        Some(PathState {
            node: Some(node),
            has_optional_link: false,
            is_dropped: self.nodes[node as usize].ends_dropped_path,
            has_dynamic_root: false,
        })
    }

    pub(super) fn child(
        &self,
        state: PathState,
        name: Atom,
        is_in_optional_chain: bool,
    ) -> Option<PathState> {
        let parent = state.node;
        let node = parent.and_then(|parent| find_node(self.nodes[parent as usize].edges, name));
        let has_optional_link = state.has_optional_link || is_in_optional_chain;
        let ends_dropped_path = !has_optional_link
            && node.is_some_and(|node| self.nodes[node as usize].ends_dropped_path);
        let is_dropped = state.is_dropped || ends_dropped_path;
        (node.is_some() || is_dropped).then_some(PathState {
            node,
            has_optional_link,
            is_dropped,
            has_dynamic_root: state.has_dynamic_root,
        })
    }

    #[inline]
    pub(super) fn value_of(&self, state: PathState) -> Option<DefineValue<'s>> {
        let value = self.nodes[state.node? as usize].value?;
        let is_there_in_every_run = matches!(
            value,
            DefineValue::RuntimeValue(_) | DefineValue::RuntimeConstant(_)
        );
        if state.has_optional_link && !is_there_in_every_run {
            return None;
        }
        match value {
            _ if is_there_in_every_run && state.has_dynamic_root => None,
            DefineValue::Constant(Constant::Number(number))
                if state.has_dynamic_root && number.is_nan() =>
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
}

#[derive(Default)]
struct NodeBuilder<'s> {
    edges: Vec<(Atom, u32)>,
    value: Option<DefineValue<'s>>,
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
