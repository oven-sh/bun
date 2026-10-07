//! The nodes TypeScript's test harness writes a line for in `.types` and `.symbols` baselines
//! (`typeWriterWalker.visitNode`).
//!
//! A [`VisitedNode`] holds the source position of such a node and its counterpart in the HIR.

use super::enclosing_declaration::or_file_scope;
use super::*;
use crate::bind::{Decl, ScopeId, SymbolId};
use crate::node::{Kind, Node, NodeData, Part};

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

/// The HIR counterpart of a visited node.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum VisitedKind {
    /// A HIR expression, without the enclosing parentheses.
    Expression(ExprId),
    /// A `ParenthesizedExpression` enclosing it, with its index counted from the outermost.
    Parenthesized(ExprId, u32),
    /// The `b` of `a.b`, the `target` of `new.target`, the `meta` of `import.meta`.
    AccessName(ExprId),
    /// An identifier in place of the required string of `import a = require("m")` or `export * from
    /// "m"`, which is not in an expression context.
    ModuleSpecifier(ExprId),
    /// The `defer` of `import.defer("m")`.
    ImportDeferName(ExprId),
    /// The `const` of `x as const` and of `<const>x`.
    ConstOfAsConst(ExprId),
    /// The name of an intrinsic element in a tag of the JSX element, and the string the HIR stores
    /// for it.
    JsxIntrinsicTagName(ExprId, ExprId),
    /// One of the two identifiers of a `JsxNamespacedName`.
    JsxNamespacedNamePart,
    /// The name of a declaration, and the symbol of the declaration.
    DeclarationName(Decl, SymbolId),
    /// The `a` of `import { a as b }` and of `export { a as b }`, with the specifier and its symbol.
    SpecifierPropertyName(Decl, SymbolId),
    /// Of a class, an interface or a type literal.
    MemberName(MemberId),
    /// The name of a property of an object literal, or of a JSX attribute.
    PropertyName(PropId),
    ImportAttributeName(PropId),
    /// The name a variable, a parameter or a binding element declares.
    BindingName(PatId),
    /// The `a` of `{ a: b }` in a binding pattern.
    BindingPropertyName(PatPropId),
    ThisParameter(FnId),
    /// The `"a"` of the member name `["a"]`, the `0` of `[0]`.
    LiteralInMemberName(MemberId),
    /// The same in an object literal.
    LiteralInPropertyName(PropId),
    /// The same in an object binding pattern.
    LiteralInBindingPropertyName(PatPropId),
    /// The same in an enum.
    LiteralInEnumMemberName(EnumMemberId),
    /// `true`, `false` or `-1` right under a `LiteralType`.
    LiteralType(TypeNodeId),
    /// The `1` of that `-1`.
    LiteralTypeOperand(TypeNodeId),
    /// Of a labeled statement, a `break` or a `continue`.
    Label(StmtId),
    /// The identifier at an index in the `A.B.C` of a type reference.
    TypeReferenceName(TypeNodeId, u32),
    /// The identifier at an index in the `A.B.C` of `implements A.B.C`, or of the `extends A.B.C`
    /// of an interface. The HIR stores a type reference there. It is an
    /// `ExpressionWithTypeArguments` (`parseHeritageClause`).
    HeritageClauseName(TypeNodeId, u32),
    /// The property access in it that ends with the identifier at an index: `A.B`, `A.B.C`.
    HeritageClausePropertyAccess(TypeNodeId, u32),
    /// The identifier at an index in the `A.B` of `import("m").A.B`.
    ImportTypeQualifierName(TypeNodeId, u32),
    /// The identifier at an index in the `a.b` of `import x = a.b`.
    ImportEqualsName(ImportEqualsId, u32),
    /// The `x` of `x is T` and of `asserts x`.
    TypePredicateParameter(TypeNodeId),
}

impl Checker<'_, '_> {
    /// `typeWriterWalker.visitNode` over `forEachASTNode`.
    pub(super) fn visited_nodes(&self, file: FileId) -> Vec<VisitedNode> {
        let hir = self.hir(file);
        // `declareSymbolEx`: `Symbol::decls` also lists the declarations the symbol rejected. Each
        // has its own symbol, created later.
        let mut symbols: FxHashMap<Decl, SymbolId> = FxHashMap::default();
        for (index, symbol) in self.bound(file).symbols.iter().enumerate() {
            // `cloneSymbol` copies the declarations, whose `Symbol` is still the one the binder
            // created.
            if !symbol.flags.contains(SymFlags::TRANSIENT) {
                let id = SymbolId(index as u32);
                symbols.extend(symbol.decls.iter().map(|&decl| (decl, id)));
            }
        }
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
                && let Some(kind) = self.visited_kind(file, node, &symbols)
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

    /// The HIR counterpart of the visited `node`. `None`: neither a type nor a symbol is printed
    /// for it.
    fn visited_kind(
        &self,
        file: FileId,
        node: Node,
        symbols: &FxHashMap<Decl, SymbolId>,
    ) -> Option<VisitedKind> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = hir.parent(node);
        // `node.Parent.Symbol`
        let symbol_of = |decl: Decl| match bound.symbol_of_declaration(decl) {
            SymbolId::NONE => symbols.get(&decl).copied(),
            own => Some(own),
        };
        let name_of = |decl: Decl| Some(VisitedKind::DeclarationName(decl, symbol_of(decl)?));
        // The identifier `name` of an entity name, or the part of the entity name that ends with it.
        let in_entity_name = |name: NameId, is_access: bool| {
            let owner = hir.find_ancestor(parent, |n| n.part() != Some(Part::Qualified));
            Some(match hir.data(owner) {
                NodeData::Type(t) => match hir[t].kind {
                    TypeNodeKind::Ref { name: all, .. } if is_access => {
                        VisitedKind::HeritageClausePropertyAccess(t, name.0 - all.start)
                    }
                    TypeNodeKind::Ref { name: all, .. }
                        if hir.kind(owner) == Kind::ExpressionWithTypeArguments =>
                    {
                        VisitedKind::HeritageClauseName(t, name.0 - all.start)
                    }
                    TypeNodeKind::Ref { name: all, .. } => {
                        VisitedKind::TypeReferenceName(t, name.0 - all.start)
                    }
                    TypeNodeKind::Import { name: all, .. } => {
                        VisitedKind::ImportTypeQualifierName(t, name.0 - all.start)
                    }
                    _ => return None,
                },
                NodeData::Stmt(s) => match hir[s].kind {
                    StmtKind::ImportEquals(i) => match hir[i].target {
                        ImportEqualsTarget::Entity(all) => {
                            VisitedKind::ImportEqualsName(i, name.0 - all.start)
                        }
                        ImportEqualsTarget::Require(_) => return None,
                    },
                    _ => return None,
                },
                _ => return None,
            })
        };
        Some(match hir.data(node) {
            _ if hir.kind(node) == Kind::OmittedExpression => return None,
            NodeData::Expr(e) => match (hir.kind(parent), hir.data(parent.row())) {
                (_, NodeData::Expr(element))
                    if hir.is_jsx_tag_name(node)
                        && self.jsx_intrinsic_tag_name(file, e).is_some() =>
                {
                    VisitedKind::JsxIntrinsicTagName(element, e)
                }
                // The one identifier of `{ a }` is its name.
                (Kind::ShorthandPropertyAssignment, NodeData::Prop(p))
                    if hir.name(parent) == node =>
                {
                    VisitedKind::PropertyName(p)
                }
                (kind, _)
                    if matches!(hir[e].kind, ExprKind::Ident(_))
                        && (kind == Kind::ExternalModuleReference
                            || hir.specifier_expressions.contains(&e)) =>
                {
                    VisitedKind::ModuleSpecifier(e)
                }
                _ => VisitedKind::Expression(e),
            },
            NodeData::Paren(p) => {
                let e = hir.parens[p.idx()].0;
                let around = hir.parens[p.idx() + 1..].iter().take_while(|p| p.0 == e);
                VisitedKind::Parenthesized(e, around.count() as u32)
            }
            NodeData::Pat(pat) => match hir.data(parent) {
                NodeData::Param(p) if hir[bound.param_fn[p.idx()]].this_param == p => {
                    VisitedKind::ThisParameter(bound.param_fn[p.idx()])
                }
                _ => VisitedKind::BindingName(pat),
            },
            NodeData::Name(name) => return in_entity_name(name, false),
            NodeData::Part(part, row) => match (part, hir.data(row)) {
                (Part::Qualified, NodeData::Name(name)) => return in_entity_name(name, true),
                (Part::Name, NodeData::Expr(e)) => match hir[e].kind {
                    ExprKind::AsConst(_) => VisitedKind::ConstOfAsConst(e),
                    ExprKind::ImportCall { .. } => VisitedKind::ImportDeferName(e),
                    ExprKind::Fn(f) => return name_of(Decl::Fn(f)),
                    ExprKind::Class(c) => return name_of(Decl::Class(c)),
                    _ => VisitedKind::AccessName(e),
                },
                (Part::Name, NodeData::Stmt(s)) => {
                    return match hir[s].kind {
                        StmtKind::Fn(f) => name_of(Decl::Fn(f)),
                        StmtKind::Class(c) => name_of(Decl::Class(c)),
                        StmtKind::Interface(i) => name_of(Decl::Interface(i)),
                        StmtKind::TypeAlias(a) => name_of(Decl::Alias(a)),
                        StmtKind::Enum(e) => name_of(Decl::Enum(e)),
                        StmtKind::Module(m) => name_of(Decl::Module(m)),
                        StmtKind::ImportEquals(i) => name_of(Decl::ImportEquals(i)),
                        StmtKind::Import(i) => name_of(Decl::ImportDefault(i)),
                        // `bindNamespaceExportDeclaration` declares a symbol for it only at the top
                        // level of a module.
                        StmtKind::ExportAsNamespace(_) => {
                            let decl = Decl::UmdGlobal(s);
                            let symbol = symbol_of(decl).unwrap_or(SymbolId::NONE);
                            Some(VisitedKind::DeclarationName(decl, symbol))
                        }
                        _ => None,
                    };
                }
                (Part::BindingsName, NodeData::Stmt(s)) => {
                    return match hir[s].kind {
                        StmtKind::Import(i) => name_of(Decl::ImportNamespace(i)),
                        _ => name_of(Decl::ExportStarAs(s)),
                    };
                }
                (Part::Name, NodeData::Member(m)) => VisitedKind::MemberName(m),
                (Part::Name, NodeData::Prop(p)) if hir.kind(parent) == Kind::ImportAttribute => {
                    VisitedKind::ImportAttributeName(p)
                }
                (Part::Name, NodeData::Prop(p)) => VisitedKind::PropertyName(p),
                (Part::Name, NodeData::EnumMember(m)) => return name_of(Decl::EnumMember(m)),
                (Part::Name, NodeData::TypeParam(p)) => return name_of(Decl::TypeParam(p)),
                (Part::Name, NodeData::ImportSpec(s)) => return name_of(Decl::ImportSpec(s)),
                (Part::Name, NodeData::ExportSpec(s)) => return name_of(Decl::ExportSpec(s)),
                (Part::Name, NodeData::Type(t)) => VisitedKind::TypePredicateParameter(t),
                (Part::PropertyName, NodeData::ImportSpec(s)) => {
                    let decl = Decl::ImportSpec(s);
                    VisitedKind::SpecifierPropertyName(decl, symbol_of(decl)?)
                }
                (Part::PropertyName, NodeData::ExportSpec(s)) => {
                    let decl = Decl::ExportSpec(s);
                    VisitedKind::SpecifierPropertyName(decl, symbol_of(decl)?)
                }
                (Part::PropertyName, NodeData::PatProp(p)) => VisitedKind::BindingPropertyName(p),
                (Part::NameLiteral, NodeData::Member(m)) => VisitedKind::LiteralInMemberName(m),
                (Part::NameLiteral, NodeData::Prop(p)) => VisitedKind::LiteralInPropertyName(p),
                (Part::NameLiteral, NodeData::PatProp(p)) => {
                    VisitedKind::LiteralInBindingPropertyName(p)
                }
                (Part::NameLiteral, NodeData::EnumMember(m)) => {
                    VisitedKind::LiteralInEnumMemberName(m)
                }
                // `IsPartOfTypeNode` treats the keyword `null` as a type wherever it appears.
                (Part::Literal, NodeData::Type(t)) if hir.kind(node) != Kind::NullKeyword => {
                    VisitedKind::LiteralType(t)
                }
                (Part::Operand, NodeData::Type(t)) => VisitedKind::LiteralTypeOperand(t),
                (Part::Label, NodeData::Stmt(s)) => VisitedKind::Label(s),
                (Part::Namespace | Part::LocalName, _) => VisitedKind::JsxNamespacedNamePart,
                _ => return None,
            },
            _ => return None,
        })
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
