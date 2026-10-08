//! Which of the things that the HIR stores a node of TypeScript's tree is, for the nodes that have
//! a type or a symbol of their own: expressions, identifiers, names of declarations.

use super::super::*;
use crate::bind::{Decl, SymbolId};
use crate::node::{Kind, Node, NodeData, Part};

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
    /// `node.Symbol` for every declaration of `file`. `declareSymbolEx`: `Symbol::decls` also lists
    /// the declarations the symbol rejected. Each has its own symbol, created later.
    pub(in crate::check) fn symbols_of_declarations(&self, file: FileId) -> FxHashMap<Decl, SymbolId> {
        let mut symbols: FxHashMap<Decl, SymbolId> = FxHashMap::default();
        for (index, symbol) in self.bound(file).symbols.iter().enumerate() {
            // `cloneSymbol` copies the declarations, whose `Symbol` is still the one the binder
            // created.
            if !symbol.flags.contains(SymFlags::TRANSIENT) {
                let id = SymbolId(index as u32);
                symbols.extend(symbol.decls.iter().map(|&decl| (decl, id)));
            }
        }
        symbols
    }

    /// The HIR counterpart of the visited `node`. `None`: neither a type nor a symbol is printed
    /// for it.
    ///
    /// `symbols`: `symbols_of_declarations`, which is asked for a declaration that its symbol has
    /// rejected.
    pub(in crate::check) fn visited_kind(
        &self,
        file: FileId,
        node: Node,
        symbols: &dyn Fn(Decl) -> Option<SymbolId>,
    ) -> Option<VisitedKind> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = hir.parent(node);
        // `node.Parent.Symbol`
        let symbol_of = |decl: Decl| match bound.symbol_of_declaration(decl) {
            SymbolId::NONE => symbols(decl),
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
}
