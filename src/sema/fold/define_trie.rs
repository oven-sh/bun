use super::inputs::{
    DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions, LinkForm, PathInPlace, PathState,
    StoredByMocks, TrieNode,
};
use super::{Constant, slice_in};
use crate::atom::Atom;
use crate::session::Arena;

impl<'s> FoldInputs<'s> {
    #[allow(clippy::large_types_passed_by_value)]
    pub fn new(options: FoldOptions<'s>, arena: &'s Arena) -> FoldInputs<'s> {
        let mut trie = TrieBuilder::default();
        for define in options.defines {
            trie.ensure_path(define.path).value = Some(define.value);
        }
        for &path in options.user_defined {
            trie.ensure_path(path).is_user_defined = true;
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
                is_user_defined: node.is_user_defined,
                ends_dropped_path: node.ends_dropped_path,
            })
            .collect();
        let root_filter = trie.roots.iter().fold(0, |filter, entry| match entry.0 {
            DefineRoot::Global(name) => filter | root_filter_bit(name),
            DefineRoot::ImportMeta => filter,
        });
        let names_in_place: Vec<PathInPlace<'s>> = (options.defines.iter())
            .filter_map(|define| match define.value {
                DefineValue::GlobalPath(&[first_name, ref rest @ ..]) => Some(PathInPlace {
                    path: define.path,
                    first_name,
                    is_one_name: rest.is_empty(),
                    is_in_bundle: false,
                }),
                _ => None,
            })
            .collect();
        let names_in_place_in_bundle: Vec<PathInPlace<'s>> = (names_in_place.iter())
            .map(|&it| PathInPlace {
                is_in_bundle: true,
                ..it
            })
            .collect();
        FoldInputs {
            nodes: slice_in(&nodes, arena),
            roots: slice_in(&trie.roots, arena),
            root_filter,
            names_in_place: slice_in(&names_in_place_in_bundle, arena),
            names_in_place_for_bun_run: slice_in(&names_in_place, arena),
            features: options.features,
            features_are_unknown: options.features_are_unknown,
            preserves_unused_imports: options.preserves_unused_imports,
            minifies_syntax: options.minifies_syntax,
            is_read_left_out_where_unused: options.is_read_left_out_where_unused,
            has_names_for_brackets: options.minifies_syntax,
            max_string_bytes: options.max_string_bytes,
            max_pattern_bytes: options.max_pattern_bytes,
            stored_by_mocks: StoredByMocks::Nothing,
        }
    }

    pub fn for_program_that_runs_in_place(self) -> FoldInputs<'s> {
        FoldInputs {
            has_names_for_brackets: true,
            names_in_place: self.names_in_place_for_bun_run,
            ..self
        }
    }

    pub fn names_in_place(&self) -> &'s [PathInPlace<'s>] {
        self.names_in_place
    }

    pub fn for_file_stored_by_mocks(self, stored_by_mocks: StoredByMocks<'s>) -> FoldInputs<'s> {
        FoldInputs {
            stored_by_mocks,
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
            ends_with_index: false,
            is_dropped: self.nodes[node as usize].ends_dropped_path,
            has_dynamic_root: false,
        })
    }

    pub(super) fn child(&self, state: PathState, name: Atom, form: LinkForm) -> Option<PathState> {
        let parent = state.node;
        let node = parent.and_then(|parent| find_node(self.nodes[parent as usize].edges, name));
        let has_optional_link = state.has_optional_link || form.is_in_optional_chain;
        let ends_with_index = form.is_index && !self.has_names_for_brackets;
        let ends_dropped_path = !has_optional_link
            && node.is_some_and(|node| self.nodes[node as usize].ends_dropped_path);
        let is_dropped = !ends_with_index && (state.is_dropped || ends_dropped_path);
        (node.is_some() || is_dropped).then_some(PathState {
            node,
            has_optional_link,
            ends_with_index,
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
        if (state.has_optional_link || state.ends_with_index) && !is_there_in_every_run {
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

    #[inline]
    pub(super) fn is_user_defined(&self, state: PathState) -> bool {
        state
            .node
            .is_some_and(|node| self.nodes[node as usize].is_user_defined)
    }

    pub(super) fn has_feature(&self, flag: Atom) -> bool {
        self.features.contains(&flag)
    }

    pub(super) fn features_are_unknown(&self) -> bool {
        self.features_are_unknown
    }

    pub(super) fn is_held_to_minified_syntax(&self) -> bool {
        self.has_names_for_brackets
    }

    pub(super) fn is_read_left_out_where_unused(&self, path: &[&[u8]]) -> bool {
        self.is_read_left_out_where_unused
            .is_some_and(|is_left_out| is_left_out(path))
    }

    #[inline]
    pub(crate) fn preserves_unused_imports(&self) -> bool {
        self.preserves_unused_imports
    }

    #[inline]
    pub(crate) fn max_string_bytes(&self) -> usize {
        self.max_string_bytes
    }

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
    is_user_defined: bool,
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
