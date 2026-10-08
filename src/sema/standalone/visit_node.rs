//! The nodes TypeScript's test harness writes a line for in `.types` and `.symbols` baselines
//! (`typeWriterWalker.visitNode`).
//!
//! A [`VisitedNode`] holds the source position of such a node and its counterpart in the HIR.

use super::services::visited::VisitedKind;
use super::*;
use crate::node::{Kind, Node};

/// A node that `visitNode` accepts.
#[derive(Copy, Clone, Debug)]
pub(super) struct VisitedNode {
    /// `SkipTrivia(text, node.Pos())`
    pub(super) start: u32,
    /// `node.End()`
    pub(super) end: u32,
    pub(super) node: Node,
    pub(super) kind: VisitedKind,
}

impl Checker<'_, '_> {
    /// `typeWriterWalker.visitNode` over `forEachASTNode`.
    pub(super) fn visited_nodes(&self, file: FileId) -> Vec<VisitedNode> {
        let hir = self.hir(file);
        let symbols = self.symbols_of_declarations(file);
        let mut nodes = Vec::with_capacity(hir.exprs.len() * 2);
        let (mut work, mut children) = (vec![Node::FILE], Vec::new());
        while let Some(node) = work.pop() {
            let start = hir.start(node);
            // Nodes reparsed from a JSDoc comment are omitted, and a comment is not a child of a
            // node.
            if node != Node::FILE && hir.is_in_jsdoc(start) {
                continue;
            }
            if (hir.is_expression_node(node)
                || hir.kind(node) == Kind::Identifier
                || hir.is_declaration_name(node))
                && let Some(kind) = self.visited_kind(file, node, &|decl| symbols.get(&decl).copied())
            {
                if !hir.is_missing(node) {
                    // `GetSourceTextOfNodeFromSourceFile`: a node that starts with a missing
                    // identifier starts at the next token.
                    let start = match hir.has_parse_diagnostics {
                        true => self.skip_trivia_from(file, start),
                        false => start,
                    };
                    let end = self.end_of_node(file, node);
                    if start < end {
                        nodes.push(VisitedNode {
                            start,
                            end,
                            node,
                            kind,
                        });
                    }
                // `createMissingNode`: a node without text, at the end of the previous token. The
                // harness places it on the line of the next token (`SkipTrivia`). Only
                // `parseThrowStatement` reports nothing for its missing identifier.
                } else if hir.has_parse_diagnostics
                    || hir.kind(hir.parent(node)) == Kind::ThrowStatement
                {
                    let start = self.skip_trivia_from(file, self.end_of_token_before(file, start));
                    nodes.push(VisitedNode {
                        start,
                        end: start,
                        node,
                        kind,
                    });
                }
            }
            hir.for_each_child(node, &mut |child| {
                children.push(child);
                false
            });
            work.extend(children.drain(..).rev());
        }
        // A stray decorator is a statement before the one it is written in
        // (`note_stray_decorators`). In TypeScript's tree it is where it is written.
        for &(start, end) in hir.stray_decorators.iter() {
            let is_in_it = |it: &VisitedNode| start <= it.start && it.end <= end;
            let Some(first) = nodes.iter().position(is_in_it) else {
                continue;
            };
            let count = nodes[first..].iter().take_while(|it| is_in_it(it)).count();
            let rest = nodes[first + count..].iter();
            let before_it = rest.take_while(|it| it.start < start).count();
            nodes[first..first + count + before_it].rotate_left(count);
        }
        nodes
    }
}
