//! The nodes TypeScript's test harness writes a line for in `.types` and `.symbols` baselines
//! (`typeWriterWalker.visitNode`).
//!
//! A [`VisitedNode`] holds the source position of such a node and its counterpart in the HIR.

use super::enclosing_declaration::or_file_scope;
use super::services::visited::VisitedKind;
use super::*;
use crate::bind::{Decl, ScopeId};
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

    /// `node.Parent`, as the scope from which names are resolved when a type or a symbol is printed
    /// for the node.
    pub(super) fn enclosing_scope_of_visited_node(
        &self,
        file: FileId,
        kind: VisitedKind,
    ) -> ScopeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match kind {
            VisitedKind::Expression(e)
            | VisitedKind::Parenthesized(e, _)
            | VisitedKind::AccessName(e)
            | VisitedKind::ModuleSpecifier(e)
            | VisitedKind::ImportDeferName(e)
            | VisitedKind::ConstOfAsConst(e)
            | VisitedKind::JsxIntrinsicTagName(e, _) => self.enclosing_scope_of_expr(file, e),
            VisitedKind::DeclarationName(decl, _) | VisitedKind::SpecifierPropertyName(decl, _) => {
                self.enclosing_scope_of_declaration(file, decl)
            }
            VisitedKind::BindingName(pat) => self.enclosing_scope_of_pat(file, pat),
            VisitedKind::LiteralInBindingPropertyName(p) | VisitedKind::BindingPropertyName(p)
                if hir[p].value.is_some() =>
            {
                self.enclosing_scope_of_pat(file, hir[p].value)
            }
            VisitedKind::ThisParameter(f) => self.enclosing_scope_of_declaration(file, Decl::Fn(f)),
            VisitedKind::LiteralInEnumMemberName(m) => {
                self.enclosing_scope_of_declaration(file, Decl::EnumMember(m))
            }
            VisitedKind::LiteralInMemberName(m) | VisitedKind::MemberName(m) => {
                self.enclosing_scope_of_member(file, m)
            }
            VisitedKind::LiteralInPropertyName(p)
            | VisitedKind::PropertyName(p)
            | VisitedKind::ImportAttributeName(p) => self.enclosing_scope_of_property(file, p),
            VisitedKind::LiteralType(node)
            | VisitedKind::LiteralTypeOperand(node)
            | VisitedKind::TypeReferenceName(node, _)
            | VisitedKind::HeritageClauseName(node, _)
            | VisitedKind::HeritageClausePropertyAccess(node, _)
            | VisitedKind::ImportTypeQualifierName(node, _)
            | VisitedKind::TypePredicateParameter(node) => {
                or_file_scope(bound.type_scope[node.idx()])
            }
            VisitedKind::ImportEqualsName(import, _) => {
                self.enclosing_scope_of_declaration(file, Decl::ImportEquals(import))
            }
            VisitedKind::Label(s) => or_file_scope(bound.stmt_scope[s.idx()]),
            VisitedKind::LiteralInBindingPropertyName(_)
            | VisitedKind::BindingPropertyName(_)
            | VisitedKind::JsxNamespacedNamePart => ScopeId(0),
        }
    }
}
