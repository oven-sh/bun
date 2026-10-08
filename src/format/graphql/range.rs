//! `rangeStart` and `rangeEnd`: Prettier's `calculateRange` (`src/main/range.js`) for GraphQL.

use super::parser::{Kind, NodeId, Tree};
use bun_lint::span::Span;
use smallvec::SmallVec;

/// A node and its ancestors, from the inside out.
type Path = SmallVec<[NodeId; 16]>;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Edge {
    Start,
    End,
}

/// Prettier's `graphqlSourceElements`
fn is_source_element(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::OperationDefinition
            | Kind::FragmentDefinition
            | Kind::VariableDefinition
            | Kind::ObjectTypeDefinition
            | Kind::FieldDefinition
            | Kind::DirectiveDefinition
            | Kind::EnumTypeDefinition
            | Kind::EnumValueDefinition
            | Kind::InputValueDefinition
            | Kind::InputObjectTypeDefinition
            | Kind::SchemaDefinition
            | Kind::OperationTypeDefinition
            | Kind::InterfaceTypeDefinition
            | Kind::UnionTypeDefinition
            | Kind::ScalarTypeDefinition
    )
}

/// Prettier's `findNodeAtOffset`. `path`: the ancestors of `node`, from the outside in. If there is a
/// source element at `offset` in `node`, the way to it is added to `path`.
fn find_node_at_offset(
    tree: &Tree,
    node: NodeId,
    offset: u32,
    edge: Edge,
    path: &mut Path,
) -> bool {
    let span = tree.span(node);
    if offset > span.end
        || offset < span.start
        || (edge == Edge::End && offset == span.start)
        || (edge == Edge::Start && offset == span.end)
    {
        return false;
    }
    path.push(node);
    if tree
        .children(node)
        .iter()
        .any(|&child| find_node_at_offset(tree, child, offset, edge, path))
        || is_source_element(tree.kind(node))
    {
        return true;
    }
    path.pop();
    false
}

/// Prettier's `findSiblingAncestors`. The paths are from the inside out.
fn find_sibling_ancestors(
    tree: &Tree,
    start_path: &[NodeId],
    end_path: &[NodeId],
) -> Option<(NodeId, NodeId)> {
    let ((&(mut start_node), start_ancestors), (&(mut end_node), end_ancestors)) =
        (start_path.split_first()?, end_path.split_first()?);
    if start_node == end_node {
        return Some((start_node, end_node));
    }
    let start = tree.span(start_node).start;
    for &ancestor in end_ancestors
        .iter()
        .take_while(|&&ancestor| tree.span(ancestor).start >= start)
    {
        end_node = ancestor;
    }
    let end = tree.span(end_node).end;
    for &ancestor in start_ancestors
        .iter()
        .take_while(|&&ancestor| tree.span(ancestor).end <= end)
    {
        start_node = ancestor;
        if start_node == end_node {
            break;
        }
    }
    Some((start_node, end_node))
}

/// The part of `text` that is formatted for the range from `start` to `end`.
pub(super) fn calculate_range(
    text: &[u8],
    tree: &Tree,
    mut start: usize,
    mut end: usize,
) -> Option<Span> {
    // The range is narrowed so that it starts and ends with something.
    let range = text.get(start..end)?;
    let trimmed = crate::text::trim_start(range);
    let is_blank = trimmed.is_empty();
    if !is_blank {
        start += range.len() - trimmed.len();
        end = start + crate::text::trim_end(trimmed).len();
    }

    let find = |offset: usize, edge| {
        let mut path = Path::new();
        find_node_at_offset(tree, tree.root(), offset as u32, edge, &mut path).then(|| {
            path.reverse();
            path
        })
    };
    let start_path = find(start, Edge::Start)?;
    let end_path = if is_blank {
        start_path.clone()
    } else {
        find(end, Edge::End)?
    };
    let (start_node, end_node) = find_sibling_ancestors(tree, &start_path, &end_path)?;
    let (start_span, end_span) = (tree.span(start_node), tree.span(end_node));
    Some(Span::new(
        start_span.start.min(end_span.start),
        start_span.end.max(end_span.end),
    ))
}
