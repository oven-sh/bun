//! Helpers of the rules of oxlint 1.87, under the names that they have there: for what a rule does
//! with a configuration of oxlint.

use super::ancestor_memo::AncestorMemo;
use crate::ast::{Flags, ModuleName, Node, StmtKind};

/// `has_ambient_typescript_ancestor`, asked of many nodes of a file.
#[derive(Default)]
pub struct AmbientAncestors<'a>(AncestorMemo<'a, ()>);

impl<'a> AmbientAncestors<'a> {
    /// Whether `node` is in a `declare namespace`, a `declare module` or a `global`.
    pub fn has_ambient_typescript_ancestor(&mut self, node: Node<'a>) -> bool {
        let is_ambient = |_, parent: Node<'a>| match parent {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Module(module) => {
                    let is_ambient = matches!(module.name(), ModuleName::Global)
                        || statement.flags().contains(Flags::AMBIENT);
                    is_ambient.then_some(())
                }
                _ => None,
            },
            _ => None,
        };
        self.0.find(node, is_ambient).is_some()
    }
}
