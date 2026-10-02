//! The nodes TypeScript's test harness writes a line for in `.types` and `.symbols` baselines (`typeWriterWalker.visitNode`).
//!
//! The harness goes through the syntax tree. The lowered tree has no node of its own for much of what is visited there, such as the
//! identifiers of `A.B.C` or a label. A [`VisitedNode`] says where such a node is written and what it belongs to in the lowered tree.

use super::*;
use crate::bind::{Decl, ScopeId};

/// A node `visitNode` takes.
#[derive(Copy, Clone, Debug)]
pub(super) struct VisitedNode {
    /// `SkipTrivia(text, node.Pos())`
    pub(super) start: u32,
    /// `node.End()`
    pub(super) end: u32,
    pub(super) kind: VisitedKind,
}

/// What a visited node is in the lowered tree.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum VisitedKind {
    /// The `"a"` of the member name `["a"]`, the `0` of `[0]`.
    LiteralInMemberName(MemberId),
    /// The same in an object literal.
    LiteralInPropertyName(PropId),
    /// The same in an object binding pattern.
    LiteralInBindingPropertyName(PatPropId),
    /// `true`, `false` or `-1` right under a `LiteralType`.
    LiteralType(TypeNodeId),
    /// The `1` of that `-1`.
    LiteralTypeOperand(TypeNodeId),
    /// By its index in `hir::File::directives`.
    Directive(u32),
    ThisParameter(FnId),
    /// The `a` of `{ a: b }` in a binding pattern.
    BindingPropertyName(PatPropId),
    /// Of a labeled statement, a `break` or a `continue`.
    Label(StmtId),
    /// The identifier at an index in the `A.B.C` of a type reference.
    TypeReferenceName(TypeNodeId, u32),
    /// The identifier at an index in the `A.B.C` of `implements A.B.C`, or of the `extends A.B.C` of an interface. The lowered tree
    /// keeps a type reference there. It is an `ExpressionWithTypeArguments` (`parseHeritageClause`).
    HeritageClauseName(TypeNodeId, u32),
    /// The property access in it that ends with the identifier at an index: `A.B`, `A.B.C`.
    HeritageClausePropertyAccess(TypeNodeId, u32),
    /// The identifier at an index in the `A.B` of `import("m").A.B`.
    ImportTypeQualifierName(TypeNodeId, u32),
    /// The identifier at an index in the `a.b` of `import x = a.b`.
    ImportEqualsName(ImportEqualsId, u32),
    /// The `defer` of `import.defer("m")`.
    ImportDeferName(ExprId),
}

impl VisitedKind {
    /// For telling apart where a difference comes from.
    pub(super) fn name(self) -> &'static str {
        match self {
            VisitedKind::LiteralInMemberName(_)
            | VisitedKind::LiteralInPropertyName(_)
            | VisitedKind::LiteralInBindingPropertyName(_) => "literal-in-computed-name",
            VisitedKind::LiteralType(_) | VisitedKind::LiteralTypeOperand(_) => "literal-type",
            VisitedKind::Directive(_) => "directive",
            VisitedKind::ThisParameter(_) => "this-parameter",
            VisitedKind::BindingPropertyName(_) => "binding-property-name",
            VisitedKind::Label(_) => "label",
            VisitedKind::TypeReferenceName(..) => "type-reference-name",
            VisitedKind::HeritageClauseName(..) => "heritage-clause-name",
            VisitedKind::HeritageClausePropertyAccess(..) => "heritage-clause-property-access",
            VisitedKind::ImportTypeQualifierName(..) => "import-type-qualifier-name",
            VisitedKind::ImportEqualsName(..) => "import-equals-name",
            VisitedKind::ImportDeferName(_) => "import-defer-name",
        }
    }
}

impl Checker<'_> {
    /// `typeWriterWalker.visitNode` over `forEachASTNode`, in no particular order.
    pub(super) fn visited_nodes(&self, file: FileId) -> Vec<VisitedNode> {
        let hir = self.hir(file);
        let mut nodes = Vec::new();
        self.visit_labels(file, &mut nodes);
        self.visit_directives(file, &mut nodes);
        self.visit_binding_property_names(file, &mut nodes);
        self.visit_literals_in_computed_names(file, &mut nodes);
        self.visit_this_parameters(file, &mut nodes);
        self.visit_names_in_type_nodes(file, &mut nodes);
        self.visit_import_equals_names(file, &mut nodes);
        self.visit_import_defer_names(file, &mut nodes);
        // `forEachASTNode` leaves out what is reparsed from a JSDoc comment, and a comment is no child of a node.
        nodes.retain(|node| node.start < node.end && !hir.is_in_jsdoc(node.start));
        nodes
    }

    /// `node.Parent`, as the scope names are looked up from when a type or a symbol is written for the node.
    pub(super) fn enclosing_scope_of_visited_node(
        &self,
        file: FileId,
        kind: VisitedKind,
    ) -> ScopeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match kind {
            VisitedKind::LiteralInMemberName(m) => self.enclosing_scope_of_member(file, m),
            VisitedKind::LiteralInPropertyName(p) => self.enclosing_scope_of_property(file, p),
            VisitedKind::LiteralInBindingPropertyName(p) | VisitedKind::BindingPropertyName(p) => {
                let value = hir[p].value;
                if value.is_some() {
                    self.enclosing_scope_of_pat(file, value)
                } else {
                    ScopeId(0)
                }
            }
            VisitedKind::LiteralType(node)
            | VisitedKind::LiteralTypeOperand(node)
            | VisitedKind::TypeReferenceName(node, _)
            | VisitedKind::HeritageClauseName(node, _)
            | VisitedKind::HeritageClausePropertyAccess(node, _)
            | VisitedKind::ImportTypeQualifierName(node, _) => {
                // The scope of the file stands in for a scope the binder did not record.
                let scope = bound.type_scope[node.idx()];
                if scope.is_some() { scope } else { ScopeId(0) }
            }
            VisitedKind::ThisParameter(f) => self.enclosing_scope_of_declaration(file, Decl::Fn(f)),
            VisitedKind::ImportEqualsName(import, _) => {
                self.enclosing_scope_of_declaration(file, Decl::ImportEquals(import))
            }
            VisitedKind::ImportDeferName(e) => self.enclosing_scope_of_expr(file, e),
            VisitedKind::Label(s) => {
                let scope = bound.stmt_scope[s.idx()];
                if scope.is_some() { scope } else { ScopeId(0) }
            }
            VisitedKind::Directive(_) => ScopeId(0),
        }
    }

    fn visit_labels(&self, file: FileId, nodes: &mut Vec<VisitedNode>) {
        let hir = self.hir(file);
        for (index, stmt) in hir.stmts.iter().enumerate() {
            let start = match stmt.kind {
                StmtKind::Labeled { .. } => stmt.pos,
                StmtKind::Break(label) | StmtKind::Continue(label) if label.is_some() => {
                    self.skip_trivia_from(file, self.end_of_token_at(file, stmt.pos))
                }
                _ => continue,
            };
            nodes.push(VisitedNode {
                start,
                end: self.end_of_token_at(file, start),
                kind: VisitedKind::Label(StmtId(index as u32)),
            });
        }
    }

    /// A directive is an `ExpressionStatement` of a string literal.
    fn visit_directives(&self, file: FileId, nodes: &mut Vec<VisitedNode>) {
        for (index, &(start, _)) in self.hir(file).directives.iter().enumerate() {
            nodes.push(VisitedNode {
                start,
                end: self.end_of_token_at(file, start),
                kind: VisitedKind::Directive(index as u32),
            });
        }
    }

    fn visit_binding_property_names(&self, file: FileId, nodes: &mut Vec<VisitedNode>) {
        let hir = self.hir(file);
        for (index, prop) in hir.pat_props.iter().enumerate() {
            // In `{ a }` the one identifier is the name that is bound. A string or a number is no identifier.
            let is_identifier = hir.text.get(prop.pos as usize).is_some_and(|&first| {
                first.is_ascii_alphabetic() || matches!(first, b'_' | b'$' | b'\\') || first >= 0x80
            });
            if matches!(prop.key, PropKey::Name(_))
                && !prop.is_rest
                && is_identifier
                && prop.value.is_some()
                && hir[prop.value].pos != prop.pos
            {
                nodes.push(VisitedNode {
                    start: prop.pos,
                    end: self.end_of_token_at(file, prop.pos),
                    kind: VisitedKind::BindingPropertyName(PatPropId(index as u32)),
                });
            }
        }
    }

    /// The string or number of `["a"]` and `[0]`, which the lowered tree keeps as the name alone. `IsInExpressionContext`: it is
    /// the expression of a `ComputedPropertyName`.
    fn visit_literals_in_computed_names(&self, file: FileId, nodes: &mut Vec<VisitedNode>) {
        let hir = self.hir(file);
        let mut names = Vec::new();
        for (index, member) in hir.members.iter().enumerate() {
            if matches!(member.key, PropKey::Name(_)) {
                let m = MemberId(index as u32);
                let bracket = super::errors_x_properties_jsx::start_of_member_name(hir, m);
                names.push((bracket, VisitedKind::LiteralInMemberName(m)));
            }
        }
        for (index, prop) in hir.props.iter().enumerate() {
            if matches!(prop.key, PropKey::Name(_)) {
                let kind = VisitedKind::LiteralInPropertyName(PropId(index as u32));
                names.push((prop.pos, kind));
            }
        }
        for (index, prop) in hir.pat_props.iter().enumerate() {
            if matches!(prop.key, PropKey::Name(_)) {
                let kind = VisitedKind::LiteralInBindingPropertyName(PatPropId(index as u32));
                names.push((prop.pos, kind));
            }
        }
        for (bracket, kind) in names {
            if hir.text.get(bracket as usize) != Some(&b'[') {
                continue;
            }
            let start = self.skip_trivia_from(file, bracket + 1);
            if matches!(
                hir.text.get(start as usize),
                Some(b'"' | b'\'' | b'`' | b'0'..=b'9' | b'.')
            ) {
                nodes.push(VisitedNode {
                    start,
                    end: self.end_of_token_at(file, start),
                    kind,
                });
            }
        }
    }

    fn visit_this_parameters(&self, file: FileId, nodes: &mut Vec<VisitedNode>) {
        for index in 0..self.hir(file).fns.len() {
            let f = FnId(index as u32);
            if let Some(start) = self.start_of_this_parameter(file, f) {
                nodes.push(VisitedNode {
                    start,
                    end: start + 4,
                    kind: VisitedKind::ThisParameter(f),
                });
            }
        }
    }

    /// The identifiers of entity names in types, and the expression nodes under a `LiteralType`.
    fn visit_names_in_type_nodes(&self, file: FileId, nodes: &mut Vec<VisitedNode>) {
        let hir = self.hir(file);
        let mut heritage: Vec<TypeNodeId> = Vec::new();
        for class in &hir.classes {
            heritage.extend(hir.ids(class.implements));
        }
        for interface in &hir.interfaces {
            heritage.extend(hir.ids(interface.extends));
        }
        heritage.sort_unstable();
        for index in 0..hir.types.len() {
            let node = TypeNodeId(index as u32);
            let start = hir[node].pos;
            match hir[node].kind {
                TypeNodeKind::Ref { name, .. } => {
                    let ranges = self.entity_name_ranges(file, start, name);
                    let is_in_heritage_clause = heritage.binary_search(&node).is_ok();
                    for (position, &(from, end)) in ranges.iter().enumerate() {
                        let position = position as u32;
                        nodes.push(VisitedNode {
                            start: from,
                            end,
                            kind: if is_in_heritage_clause {
                                VisitedKind::HeritageClauseName(node, position)
                            } else {
                                VisitedKind::TypeReferenceName(node, position)
                            },
                        });
                        // A `QualifiedName` is neither an expression node nor an identifier.
                        if position > 0 && is_in_heritage_clause {
                            nodes.push(VisitedNode {
                                start: ranges[0].0,
                                end,
                                kind: VisitedKind::HeritageClausePropertyAccess(node, position),
                            });
                        }
                    }
                }
                TypeNodeKind::Import { name, .. } if !name.is_empty() => {
                    let Some(qualifier) = self.start_of_import_type_qualifier(file, node) else {
                        continue;
                    };
                    let ranges = self.entity_name_ranges(file, qualifier, name);
                    for (position, (start, end)) in ranges.into_iter().enumerate() {
                        nodes.push(VisitedNode {
                            start,
                            end,
                            kind: VisitedKind::ImportTypeQualifierName(node, position as u32),
                        });
                    }
                }
                // `IsExpressionNode` goes by the kind alone for `true`, `false` and a `PrefixUnaryExpression`, and the operand of
                // the `-` is in an expression context.
                TypeNodeKind::BoolLit(_) => nodes.push(VisitedNode {
                    start,
                    end: self.end_of_token_at(file, start),
                    kind: VisitedKind::LiteralType(node),
                }),
                TypeNodeKind::NumberLit(_) | TypeNodeKind::BigIntLit { .. }
                    if hir.text.get(start as usize) == Some(&b'-') =>
                {
                    let end = self.end_of_type_node(file, node);
                    nodes.push(VisitedNode {
                        start,
                        end,
                        kind: VisitedKind::LiteralType(node),
                    });
                    nodes.push(VisitedNode {
                        start: self.skip_trivia_from(file, start + 1),
                        end,
                        kind: VisitedKind::LiteralTypeOperand(node),
                    });
                }
                _ => {}
            }
        }
    }

    fn visit_import_equals_names(&self, file: FileId, nodes: &mut Vec<VisitedNode>) {
        for (index, import) in self.hir(file).import_equals.iter().enumerate() {
            let ImportEqualsTarget::Entity(entity) = import.target else {
                continue;
            };
            let import = ImportEqualsId(index as u32);
            let Some(reference) = self.start_of_import_equals_reference(file, import) else {
                continue;
            };
            let ranges = self.entity_name_ranges(file, reference, entity);
            for (position, (start, end)) in ranges.into_iter().enumerate() {
                nodes.push(VisitedNode {
                    start,
                    end,
                    kind: VisitedKind::ImportEqualsName(import, position as u32),
                });
            }
        }
    }

    /// The `defer` of `import.defer(..)` is the name of a `MetaProperty`.
    fn visit_import_defer_names(&self, file: FileId, nodes: &mut Vec<VisitedNode>) {
        let hir = self.hir(file);
        for (index, expr) in hir.exprs.iter().enumerate() {
            let ExprKind::ImportCall(specifier) = expr.kind else {
                continue;
            };
            if !hir
                .deferred_import_calls
                .iter()
                .any(|call| call.0 == specifier)
            {
                continue;
            }
            let dot = self.skip_trivia_from(file, self.end_of_token_at(file, expr.pos));
            if hir.text.get(dot as usize) != Some(&b'.') {
                continue;
            }
            let start = self.skip_trivia_from(file, dot + 1);
            nodes.push(VisitedNode {
                start,
                end: self.end_of_token_at(file, start),
                kind: VisitedKind::ImportDeferName(ExprId(index as u32)),
            });
        }
    }
}
