// printer/emitcontext.go: the side tables that the printer reads to customize emit. `Factory` is made on demand by new_node_factory.
use crate::ast::{
    Ast, Kind, NodeFlags, NodeId, is_identifier, is_parse_tree_node, is_private_identifier,
};
use crate::core::{TextRange, new_text_range};
use crate::nodebuilder::types::define_flags;
use crate::printer::emitflags::EmitFlags;
use crate::printer::generatedidentifierflags::GeneratedIdentifierFlags;
use bun_collections::HashMap;

// Ensures unique generated identifiers get unique names, but clones get the same name.
pub type AutoGenerateId = u32;

#[derive(Clone, Default)]
pub struct AutoGenerateInfo {
    // Specifies whether to auto-generate the text for an identifier.
    pub flags: GeneratedIdentifierFlags,
    pub id: AutoGenerateId,
    // Optional prefix to apply to the start of the generated name
    pub prefix: Vec<u8>,
    // Optional suffix to apply to the end of the generated name
    pub suffix: Vec<u8>,
    // For a GeneratedIdentifierFlagsNode, the node from which to generate an identifier
    pub node: NodeId,
}

// Stores side-table information used during transformation that can be read by the printer to customize emit
#[derive(Default)]
pub struct EmitContext {
    pub(crate) auto_generate: HashMap<NodeId, AutoGenerateInfo>,
    pub(crate) text_source: HashMap<NodeId, NodeId>,
    original: HashMap<NodeId, NodeId>,
    emit_nodes: HashMap<NodeId, EmitNode>,
}

pub fn new_emit_context() -> EmitContext {
    EmitContext::default()
}

define_flags!(EmitNodeFlags: u32 {
    HAS_COMMENT_RANGE = 1 << 0,
    HAS_SOURCE_MAP_RANGE = 1 << 1,
});

#[derive(Clone, Debug)]
pub struct SynthesizedComment {
    pub kind: Kind,
    pub loc: TextRange,
    pub has_leading_new_line: bool,
    pub has_trailing_new_line: bool,
    pub text: Vec<u8>,
}

// `helpers`, `typeNode` and `snippetElement` belong to transformations and the language service and have no field here.
#[derive(Default)]
struct EmitNode {
    flags: EmitNodeFlags,
    emit_flags: EmitFlags,
    comment_range: TextRange,
    source_map_range: TextRange,
    token_source_map_ranges: Option<HashMap<Kind, TextRange>>,
    external_helpers_module_name: NodeId,
    leading_comments: Vec<SynthesizedComment>,
    trailing_comments: Vec<SynthesizedComment>,
}

impl EmitNode {
    // NOTE: This method is not guaranteed to be thread-safe
    fn copy_from(&mut self, source: &EmitNode) {
        self.flags = source.flags;
        self.emit_flags = source.emit_flags;
        self.comment_range = source.comment_range;
        self.source_map_range = source.source_map_range;
        self.token_source_map_ranges = source.token_source_map_ranges.as_ref().map(|ranges| {
            let mut copy: HashMap<Kind, TextRange> = HashMap::default();
            for (kind, range) in ranges {
                copy.insert(*kind, *range);
            }
            copy
        });
        self.external_helpers_module_name = source.external_helpers_module_name;
    }
}

impl EmitContext {
    pub(crate) fn on_create(&mut self, a: Ast<'_>, node: NodeId) {
        a.set_flags(node, a.flags(node) | NodeFlags::SYNTHESIZED);
    }

    pub(crate) fn on_update(&mut self, a: Ast<'_>, updated: NodeId, original: NodeId) {
        self.set_original(a, updated, original);
    }

    pub(crate) fn on_clone(&mut self, a: Ast<'_>, updated: NodeId, original: NodeId) {
        self.set_original(a, updated, original);
        if is_identifier(a, updated) || is_private_identifier(a, updated) {
            if let Some(auto_generate) = self.auto_generate.get(&original) {
                let auto_generate_copy = auto_generate.clone();
                self.auto_generate.insert(updated, auto_generate_copy);
            }
        }
    }

    // Walks the associated AutoGenerateInfo entries of a name to find the root node from which the name should be generated.
    pub fn get_node_for_generated_name(&self, a: Ast<'_>, name: NodeId) -> NodeId {
        a.unhandled("EmitContext.GetNodeForGeneratedName", name)
    }

    // Sets the original node for a given node: the equivalent of `setOriginalNode` in Strada.
    pub fn set_original(&mut self, a: Ast<'_>, node: NodeId, original: NodeId) {
        self.set_original_ex(a, node, original, false);
    }

    pub fn set_original_ex(
        &mut self,
        a: Ast<'_>,
        node: NodeId,
        original: NodeId,
        allow_overwrite: bool,
    ) {
        if original.is_nil() {
            return a.unhandled("Original cannot be nil.", node);
        }
        match self.original.get(&node).copied() {
            None => {
                self.original.insert(node, original);
                if self.emit_nodes.contains_key(&original) {
                    let mut target = self.emit_nodes.remove(&node).unwrap_or_default();
                    if let Some(source) = self.emit_nodes.get(&original) {
                        target.copy_from(source);
                    }
                    self.emit_nodes.insert(node, target);
                }
            }
            Some(existing) => {
                if !allow_overwrite && existing != original {
                    return a.unhandled("Original node already set.", node);
                } else if allow_overwrite {
                    self.original.insert(node, original);
                }
            }
        }
    }

    // Gets the original node for a given node: the equivalent of reading `node.original` in Strada.
    pub fn original(&self, node: NodeId) -> NodeId {
        self.original.get(&node).copied().unwrap_or(NodeId::NIL)
    }

    // Gets the most original node associated with this node by walking Original pointers.
    pub fn most_original(&self, node: NodeId) -> NodeId {
        let mut node = node;
        if !node.is_nil() {
            let mut original = self.original(node);
            while !original.is_nil() {
                node = original;
                original = self.original(node);
            }
        }
        node
    }

    // Gets the original parse tree node for a given node: the equivalent of `getParseTreeNode` in Strada.
    pub fn parse_node(&self, a: Ast<'_>, node: NodeId) -> NodeId {
        let node = self.most_original(node);
        if !node.is_nil() && is_parse_tree_node(a, node) {
            return node;
        }
        NodeId::NIL
    }

    pub fn emit_flags(&self, node: NodeId) -> EmitFlags {
        if let Some(emit_node) = self.emit_nodes.get(&node) {
            return emit_node.emit_flags;
        }
        EmitFlags::NONE
    }

    pub fn set_emit_flags(&mut self, node: NodeId, flags: EmitFlags) {
        self.emit_nodes.entry(node).or_default().emit_flags = flags;
    }

    pub fn add_emit_flags(&mut self, node: NodeId, flags: EmitFlags) {
        self.emit_nodes.entry(node).or_default().emit_flags |= flags;
    }

    // Gets the range to use for a node when emitting comments.
    pub fn comment_range(&self, a: Ast<'_>, node: NodeId) -> TextRange {
        if let Some(emit_node) = self.emit_nodes.get(&node) {
            if emit_node.flags.intersects(EmitNodeFlags::HAS_COMMENT_RANGE) {
                return emit_node.comment_range;
            }
        }
        a.loc(node)
    }

    // Sets the range to use for a node when emitting comments.
    pub fn set_comment_range(&mut self, node: NodeId, loc: TextRange) {
        let emit_node = self.emit_nodes.entry(node).or_default();
        emit_node.comment_range = loc;
        emit_node.flags |= EmitNodeFlags::HAS_COMMENT_RANGE;
    }

    // Sets the range to use for a node when emitting comments.
    pub fn assign_comment_range(&mut self, a: Ast<'_>, to: NodeId, from: NodeId) {
        let range = self.comment_range(a, from);
        self.set_comment_range(to, range);
    }

    // Gets the range to use for a node when emitting source maps.
    pub fn source_map_range(&self, a: Ast<'_>, node: NodeId) -> TextRange {
        if let Some(emit_node) = self.emit_nodes.get(&node) {
            if emit_node
                .flags
                .intersects(EmitNodeFlags::HAS_SOURCE_MAP_RANGE)
            {
                return emit_node.source_map_range;
            }
        }
        a.loc(node)
    }

    // Gets the range for a token of a node when emitting source maps.
    pub fn token_source_map_range(&self, node: NodeId, kind: Kind) -> Option<TextRange> {
        let emit_node = self.emit_nodes.get(&node)?;
        emit_node
            .token_source_map_ranges
            .as_ref()?
            .get(&kind)
            .copied()
    }

    pub fn get_external_helpers_module_name(&self, a: Ast<'_>, node: NodeId) -> NodeId {
        let parse_node = self.parse_node(a, node);
        if !parse_node.is_nil() {
            if let Some(emit_node) = self.emit_nodes.get(&parse_node) {
                return emit_node.external_helpers_module_name;
            }
        }
        NodeId::NIL
    }

    pub fn add_synthetic_leading_comment(
        &mut self,
        node: NodeId,
        kind: Kind,
        text: &[u8],
        has_trailing_new_line: bool,
    ) -> NodeId {
        self.emit_nodes
            .entry(node)
            .or_default()
            .leading_comments
            .push(SynthesizedComment {
                kind,
                loc: new_text_range(-1, -1),
                has_leading_new_line: false,
                has_trailing_new_line,
                text: text.to_vec(),
            });
        node
    }

    pub fn get_synthetic_leading_comments(&self, node: NodeId) -> &[SynthesizedComment] {
        match self.emit_nodes.get(&node) {
            Some(emit_node) => &emit_node.leading_comments,
            None => &[],
        }
    }

    pub fn add_synthetic_trailing_comment(
        &mut self,
        node: NodeId,
        kind: Kind,
        text: &[u8],
        has_trailing_new_line: bool,
    ) -> NodeId {
        self.emit_nodes
            .entry(node)
            .or_default()
            .trailing_comments
            .push(SynthesizedComment {
                kind,
                loc: new_text_range(-1, -1),
                has_leading_new_line: false,
                has_trailing_new_line,
                text: text.to_vec(),
            });
        node
    }

    pub fn get_synthetic_trailing_comments(&self, node: NodeId) -> &[SynthesizedComment] {
        match self.emit_nodes.get(&node) {
            Some(emit_node) => &emit_node.trailing_comments,
            None => &[],
        }
    }
}
