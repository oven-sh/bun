//! `getSourceFileOfNode.ts`

use crate::types::{SourceFile, TsNode};

/// `getSourceFileOfNode(node)`, which is [`TsNode::get_source_file`].
#[inline]
pub fn get_source_file_of_node(node: TsNode<'_>) -> SourceFile<'_> {
    node.get_source_file()
}
