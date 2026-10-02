//! The type at every expression and declaration name of a file: what TypeScript's test harness writes into `.types` baselines
//! (`typeWriterWalker`, `GetTypeAtLocation`).

use super::visit_node::{VisitedKind, VisitedNode};
use super::*;
use crate::bind::{
    ClassOwner, Decl, FnOwner, MemberDeclaration, MemberOwner, Parent, PatParent, SymbolId,
    flags_of_member, member_flags,
};

/// `typeWriterResult`
pub struct TypeAtLocation {
    pub start: u32,
    pub end: u32,
    pub type_text: String,
    /// For telling apart where a difference comes from.
    pub kind: VisitedKind,
}

/// What the walk for the types of a file keeps from one node to the next.
struct TypeWalk {
    /// `literal_types_in_resolved_context`
    literal_types: FxHashMap<ExprId, TypeId>,
    literal_prop_types: FxHashMap<PropId, TypeId>,
    /// The type that was written last for an expression, and how it is written. The parentheses around an expression and the name of a
    /// property access repeat it.
    text_of_expr: Vec<Option<(TypeId, String)>>,
}

impl Checker<'_> {
    /// `typeWriterWalker.getTypes`, in no particular order. The file must have been checked, as in the harness.
    pub fn types_at_locations(&mut self, file: FileId) -> Vec<TypeAtLocation> {
        let hir = self.hir(file);
        let (literal_types, literal_prop_types) = self.literal_types_in_resolved_context(file);
        let mut walk = TypeWalk {
            literal_types,
            literal_prop_types,
            text_of_expr: vec![None; hir.exprs.len()],
        };
        let nodes = self.visited_nodes(file);
        let mut results = Vec::with_capacity(nodes.len());
        for node in nodes {
            self.write_type_of_visited_node(file, node, &mut walk, &mut results);
        }
        results
    }

    /// `writeTypeOrSymbol`, in the walk for types.
    fn write_type_of_visited_node(
        &mut self,
        file: FileId,
        node: VisitedNode,
        walk: &mut TypeWalk,
        results: &mut Vec<TypeAtLocation>,
    ) {
        if self.is_left_out_of_types(file, node.kind) {
            return;
        }
        let ty = self.get_type_of_visited_node(file, node, walk);
        let type_text = if ty == TypeId::ERROR && self.is_error_type_written_as_any(file, node.kind)
        {
            "any".to_owned()
        } else {
            self.type_text_of_visited_node(file, node.kind, ty, walk)
        };
        results.push(TypeAtLocation {
            start: node.start,
            end: node.end,
            type_text,
            kind: node.kind,
        });
    }

    fn type_text_of_visited_node(
        &mut self,
        file: FileId,
        kind: VisitedKind,
        ty: TypeId,
        walk: &mut TypeWalk,
    ) -> String {
        let repeated = match kind {
            VisitedKind::Expression(e)
            | VisitedKind::Parenthesized(e, _)
            | VisitedKind::AccessName(e) => Some(e.idx()),
            _ => None,
        };
        if let Some(index) = repeated
            && let Some((written, text)) = &walk.text_of_expr[index]
            && *written == ty
        {
            return text.clone();
        }
        let scope = self.enclosing_scope_of_visited_node(file, kind);
        if let VisitedKind::DeclarationName(decl, _) | VisitedKind::SpecifierPropertyName(decl, _) =
            kind
        {
            self.enclosing_module_specifier_mode =
                self.mode_of_module_specifier_of_declaration(file, decl);
        }
        let text = self.type_to_string_for_baseline_at(ty, file, scope);
        self.enclosing_module_specifier_mode = None;
        if let Some(index) = repeated {
            walk.text_of_expr[index] = Some((ty, text.clone()));
        }
        text
    }

    /// What `writeTypeOrSymbol` leaves out of the walk for types.
    fn is_left_out_of_types(&self, file: FileId, kind: VisitedKind) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match kind {
            VisitedKind::Expression(e) => match hir[e].kind {
                // `IsPartOfTypeNode` takes the keyword `null` for a type wherever it is written.
                ExprKind::Null => true,
                // An assertion whose type node is reparsed from a `@type` or `@satisfies` tag.
                ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => {
                    ty.is_some() && hir.is_in_jsdoc(hir[ty].pos)
                }
                ExprKind::AsConst(_) => hir.is_js,
                _ => false,
            },
            // `GetMeaningFromDeclaration(node.Parent)` is without `SemanticMeaningValue`. The name of a type alias is written all the
            // same, and that of a namespace if it is `ModuleInstanceStateInstantiated`.
            VisitedKind::DeclarationName(Decl::Interface(_) | Decl::TypeParam(_), _) => true,
            VisitedKind::DeclarationName(Decl::Module(m), _) => {
                matches!(hir[m].name, ModuleName::Ident(_))
                    && !(bound.module_instantiated[m.idx()]
                        && !self.is_const_enum_only_module(file, m))
            }
            // `IsPartOfTypeNode`: `const` is a type reference, and a `TypePredicate` a type node.
            VisitedKind::ConstOfAsConst(_) | VisitedKind::TypePredicateParameter(_) => true,
            // `isPartOfTypeNodeInParent`: of `A.B.C` only `C` and the whole are right under a type node.
            // In a heritage clause the same holds of the property accesses (`isPartOfTypeExpressionWithTypeArguments`).
            VisitedKind::TypeReferenceName(node, index)
            | VisitedKind::HeritageClauseName(node, index)
            | VisitedKind::HeritageClausePropertyAccess(node, index) => {
                matches!(hir[node].kind, TypeNodeKind::Ref { name, .. } if index as usize + 1 == name.len())
            }
            // The `b` of `typeof import("m").a.b` is not: `isPartOfTypeNodeInParent` leaves out an `ImportType` with `IsTypeOf`.
            VisitedKind::ImportTypeQualifierName(node, index) => {
                matches!(hir[node].kind, TypeNodeKind::Import { name, is_typeof: false, .. }
                    if index as usize + 1 == name.len())
            }
            _ => false,
        }
    }

    /// The exceptions of `writeTypeOrSymbol`: whether the error type of the node is written `any` in a test without errors too.
    fn is_error_type_written_as_any(&self, file: FileId, kind: VisitedKind) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match kind {
            // `IsBindingElement(node.Parent)`, `IsLabelName(node)`, `IsMetaProperty(node.Parent)`,
            // `IsPropertyAccessOrQualifiedName(node.Parent)`
            VisitedKind::BindingPropertyName(_)
            | VisitedKind::Label(_)
            | VisitedKind::ImportDeferName(_)
            | VisitedKind::AccessName(_) => true,
            // `isImportStatementName`, `isExportStatementName`, `IsGlobalScopeAugmentation(node.Parent)`
            VisitedKind::SpecifierPropertyName(..) => true,
            VisitedKind::DeclarationName(decl, _) => match decl {
                Decl::ImportDefault(_)
                | Decl::ImportSpec(_)
                | Decl::ImportEquals(_)
                | Decl::ExportSpec(_) => true,
                Decl::Module(m) => matches!(hir[m].name, ModuleName::Global),
                _ => false,
            },
            VisitedKind::BindingName(pat) => matches!(
                bound.pat_parent[pat.idx()],
                PatParent::Prop(..) | PatParent::Elem(..)
            ),
            VisitedKind::Expression(e) | VisitedKind::Parenthesized(e, _) => {
                self.is_child_of_parent_of_expr(file, kind)
                    && match bound.expr_parent[e.idx()] {
                        Parent::Expr(parent) if parent.is_some() => {
                            matches!(hir[parent].kind, ExprKind::Dot { obj, .. } if obj == e)
                        }
                        // `isExportStatementName`
                        Parent::Stmt(s) if s.is_some() => matches!(
                            hir[s].kind,
                            StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                        ),
                        Parent::PatPropDefault(_) | Parent::PatElemDefault(_) => true,
                        _ => false,
                    }
            }
            // `IsPropertyAccessOrQualifiedName(node.Parent)`
            VisitedKind::TypeReferenceName(node, _)
            | VisitedKind::HeritageClauseName(node, _)
            | VisitedKind::HeritageClausePropertyAccess(node, _)
            | VisitedKind::ImportTypeQualifierName(node, _) => matches!(
                hir[node].kind,
                TypeNodeKind::Ref { name, .. } | TypeNodeKind::Import { name, .. } if name.len() > 1
            ),
            VisitedKind::ImportEqualsName(import, _) => {
                matches!(hir[import].target, ImportEqualsTarget::Entity(entity) if entity.len() > 1)
            }
            _ => false,
        }
    }

    /// Whether the node is the child `bound.expr_parent` speaks of: an expression with all the parentheses around it.
    fn is_child_of_parent_of_expr(&self, file: FileId, kind: VisitedKind) -> bool {
        match kind {
            VisitedKind::Parenthesized(_, depth) => depth == 0,
            VisitedKind::Expression(e) => !is_parenthesized(self.hir(file), e),
            _ => false,
        }
    }

    /// `getTypeOfNode`, and before it what `writeTypeOrSymbol` asks of the node after the `extends` of a class.
    fn get_type_of_visited_node(
        &mut self,
        file: FileId,
        node: VisitedNode,
        walk: &TypeWalk,
    ) -> TypeId {
        let hir = self.hir(file);
        // No semantic question is answered within a `with` block.
        if hir.is_in_with(node.start) {
            return TypeId::ERROR;
        }
        match node.kind {
            VisitedKind::Expression(e)
            | VisitedKind::Parenthesized(e, _)
            | VisitedKind::AccessName(e) => {
                // `IsExpressionWithTypeArgumentsInClassExtendsClause(node.Parent)`: the base type, unless it is `any` or there is none.
                if self.is_child_of_parent_of_expr(file, node.kind)
                    && let Parent::ClassExtends(c) = self.bound(file).expr_parent[e.idx()]
                {
                    let class = self
                        .files()
                        .sym(file, self.bound(file).class_symbol[c.idx()]);
                    if let Some(&base) = self.base_types(class).first()
                        && !base.is_any()
                    {
                        return base;
                    }
                }
                self.type_of_visited_expression(file, e, walk)
            }
            VisitedKind::BindingName(pat) => self.type_of_binding_name(file, pat),
            VisitedKind::TaggedTemplateLiteral(e) => match hir[e].kind {
                // `checkTemplateExpression` does not evaluate it: with substitutions it is a `string`.
                ExprKind::TaggedTemplate(c) if hir[c].args.is_empty() => {
                    let raw = &hir.text[node.start as usize + 1..node.end as usize - 1];
                    self.string_literal(self.files().atoms.intern(raw), false)
                }
                _ => TypeId::STRING,
            },
            // `IsJsxTagName`: the identifier is an expression, and `checkIdentifier` resolves it as a value from where the element is.
            VisitedKind::JsxIntrinsicTagName(element, tag) => {
                let scope = self.bound(file).expr_scope.get(&element);
                let (ExprKind::String(name), Some(&scope)) = (hir[tag].kind, scope) else {
                    return TypeId::ERROR;
                };
                let ty = self.type_of_entity(file, scope, &[name]);
                self.regular(ty)
            }
            VisitedKind::DeclarationName(decl, symbol) => {
                self.type_of_declaration_name(file, decl, symbol, node.start)
            }
            // `getImmediateAliasedSymbol`: the type of what the specifier stands for.
            VisitedKind::SpecifierPropertyName(_, symbol) => {
                let sym = self.files().sym(file, symbol);
                self.type_of_symbol(sym)
            }
            VisitedKind::MemberName(m) => self.type_of_member_name(file, m),
            VisitedKind::PropertyName(p) => match walk.literal_prop_types.get(&p) {
                // `getTypeOfSymbol` of the property first checks its initializer when the writer asks, under the same contextual type.
                Some(&ty) => self.widened(ty),
                // `declareSymbolEx`: what has no name has a symbol of its own.
                None if matches!(hir[p].key, PropKey::None) => self.type_of_literal_prop(file, p),
                None => self.type_of_literal_member_symbol(file, p),
            },
            VisitedKind::LiteralInMemberName(m) => {
                self.type_of_literal_in_computed_name(file, hir[m].key, node.start)
            }
            VisitedKind::LiteralInPropertyName(p) => {
                self.type_of_literal_in_computed_name(file, hir[p].key, node.start)
            }
            VisitedKind::LiteralInBindingPropertyName(p) => {
                self.type_of_literal_in_computed_name(file, hir[p].key, node.start)
            }
            VisitedKind::LiteralInEnumMemberName(m) => {
                self.type_of_literal_in_computed_name(file, PropKey::Name(hir[m].name), node.start)
            }
            VisitedKind::LiteralType(literal) => self.type_from_node(file, literal),
            VisitedKind::LiteralTypeOperand(literal) => match hir[literal].kind {
                TypeNodeKind::NumberLit(n) => self.number_literal(-hir.numbers[n as usize], false),
                TypeNodeKind::BigIntLit { text, .. } => self.intern(TypeData::BigIntLit {
                    text,
                    negative: false,
                    fresh: false,
                }),
                _ => TypeId::ERROR,
            },
            VisitedKind::Directive(index) => {
                self.string_literal(hir.directives[index as usize].1, false)
            }
            VisitedKind::ThisParameter(f) => self.type_from_node(file, hir[f].this_ty),
            // `getRegularTypeOfExpression` of the access, and of the name it ends with (`isRightSideOfQualifiedNameOrPropertyAccess`).
            VisitedKind::HeritageClauseName(reference, index)
            | VisitedKind::HeritageClausePropertyAccess(reference, index) => {
                let TypeNodeKind::Ref { name, .. } = hir[reference].kind else {
                    return TypeId::ERROR;
                };
                let names: Vec<Atom> = hir.ids(name).take(index as usize + 1).collect();
                let scope = self.bound(file).type_scope[reference.idx()];
                let ty = self.type_of_entity(file, scope, &names);
                self.regular(ty)
            }
            VisitedKind::ImportEqualsName(import, index) => {
                self.type_of_import_equals_name(file, import, index as usize)
            }
            // Nothing applies.
            VisitedKind::BindingPropertyName(_)
            | VisitedKind::Label(_)
            | VisitedKind::TypeReferenceName(..)
            | VisitedKind::ImportTypeQualifierName(..)
            | VisitedKind::ImportDeferName(_)
            | VisitedKind::ImportAttributeName(_)
            | VisitedKind::JsxNamespacedNamePart
            | VisitedKind::ConstOfAsConst(_)
            | VisitedKind::TypePredicateParameter(_) => TypeId::ERROR,
        }
    }

    /// `getTypeOfNode` of an expression, of the parentheses around it, and of the name a property access ends with
    /// (`isRightSideOfQualifiedNameOrPropertyAccess`).
    fn type_of_visited_expression(&mut self, file: FileId, e: ExprId, walk: &TypeWalk) -> TypeId {
        let hir = self.hir(file);
        match hir[e].kind {
            // `getResolvedSymbol`: `NodeIsMissing`
            ExprKind::Missing | ExprKind::Ident(known::empty) => return TypeId::ERROR,
            // `checkPrivateIdentifierExpression`
            ExprKind::String(_) if is_private_name_at(hir, hir[e].pos) => {
                return TypeId::ANY;
            }
            _ => {}
        }
        if let Some(ty) = self.type_of_export_assignment_name(file, e) {
            return ty;
        }
        // `getRegularTypeOfExpression`
        let ty = match walk.literal_types.get(&e) {
            Some(&ty) => ty,
            None => match hir[e].kind {
                // `checkSpreadExpression`
                ExprKind::Spread(operand) => {
                    let iterable = match walk.literal_types.get(&operand) {
                        Some(&ty) => ty,
                        None => self.type_of_expr(file, operand),
                    };
                    self.iterated_type_if_any(iterable, false)
                        .unwrap_or(TypeId::ANY)
                }
                _ => self.type_of_expr(file, e),
            },
        };
        self.regular(ty)
    }

    /// `getTypeOfSymbol` of the symbol the name `pat` declares.
    fn type_of_binding_name(&mut self, file: FileId, pat: PatId) -> TypeId {
        let (declared_in, first) = self.value_declaration_of_variable_name(file, pat);
        let ty = self.type_of_pat(declared_in, first);
        // `bindVariableDeclarationOrBindingElement`: `const x = require(..)` declares an alias. `getTypeOfNode` of its name is
        // the type of what the alias stands for.
        let required = self.bound(file).pat_symbol[pat.idx()];
        if required.is_some()
            && self.bound(file).symbols[required.idx()]
                .flags
                .contains(SymFlags::ALIAS)
        {
            let alias = self.files().sym(file, required);
            self.type_of_symbol(alias)
        } else {
            ty
        }
    }

    /// Of the string or the number at `start`, which is written in brackets for the name `key`.
    fn type_of_literal_in_computed_name(
        &mut self,
        file: FileId,
        key: PropKey,
        start: u32,
    ) -> TypeId {
        let PropKey::Name(name) = key else {
            return TypeId::ERROR;
        };
        if matches!(
            self.hir(file).text.get(start as usize),
            Some(b'"' | b'\'' | b'`')
        ) {
            return self.string_literal(name, false);
        }
        match self.atom_text(name).parse::<f64>() {
            Ok(value) => self.number_literal(value, false),
            Err(_) => TypeId::ERROR,
        }
    }

    /// `getSymbolOfPartOfRightHandSideOfImportEquals`: of `import x = a.b.c`, `a` and `a.b` mean namespaces, and so does the `a` of
    /// `import x = a`. `getTypeOfNode`: the declared type of what a name means, or else its type.
    fn type_of_import_equals_name(
        &mut self,
        file: FileId,
        import: ImportEqualsId,
        index: usize,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ImportEqualsTarget::Entity(entity) = hir[import].target else {
            return TypeId::ERROR;
        };
        let names: Vec<Atom> = hir.ids(entity).collect();
        let meaning = if names.len() == 1 || index + 1 < names.len() {
            SymFlags::NAMESPACE
        } else {
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
        };
        let scope = bound.import_equals_scope[import.idx()];
        let symbol = self
            .files()
            .resolve_entity(file, scope, &names[..=index], meaning)
            .and_then(|found| self.files().resolve_alias_if_needed(found));
        let ty = match symbol {
            // `getDeclaredTypeOfEnumMember`
            Some(symbol) if self.files().flags(symbol).contains(SymFlags::ENUM_MEMBER) => {
                self.type_of_symbol(symbol)
            }
            Some(symbol) if self.files().means(symbol, SymFlags::TYPE) => {
                self.declared_type(symbol)
            }
            Some(symbol) => self.type_of_symbol(symbol),
            None => TypeId::ERROR,
        };
        // A lone name means a namespace, which is `any` only in error.
        if names.len() == 1 && ty.is_any() {
            TypeId::ERROR
        } else {
            ty
        }
    }

    /// `getTypeOfNode` of the bare name in `export = a` or `export default a`, which `IsInExpressionContext` does not count as an
    /// expression (`isInRightSideOfImportOrExportAssignment`): the declared type of what it names, or else the type of that symbol.
    fn type_of_export_assignment_name(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let ExprKind::Ident(name) = hir[e].kind else {
            return None;
        };
        let crate::bind::Parent::Stmt(stmt) = bound.expr_parent[e.idx()] else {
            return None;
        };
        if stmt.is_none()
            || !matches!(
                hir[stmt].kind,
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
            )
            || is_parenthesized(hir, e)
        {
            return None;
        }
        let meaning = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
        let symbol = bound
            .expr_scope
            .get(&e)
            .and_then(|&scope| files.resolve_name(file, scope, name, meaning))
            .and_then(|found| files.resolve_alias(found));
        // `undefined` and `globalThis` have no symbol here, and the expression has the error type if the name does not resolve.
        let symbol = symbol?;
        Some(
            if self.type_flags_of_symbol(symbol).intersects(SymFlags::TYPE) {
                self.declared_type(symbol)
            } else {
                // The target of a namespace import can be a copy of the module (`resolveESModuleSymbol`): its type is that of the alias.
                let written = bound
                    .expr_scope
                    .get(&e)
                    .and_then(|&scope| files.resolve_name(file, scope, name, meaning));
                self.type_of_symbol(written.unwrap_or(symbol))
            },
        )
    }

    /// `getTypeOfNode` of the name of `decl`, which starts at `start`. `symbol`: that of `decl`.
    fn type_of_declaration_name(
        &mut self,
        file: FileId,
        decl: Decl,
        symbol: SymbolId,
        start: u32,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if symbol.is_none() {
            return TypeId::ERROR;
        }
        let sym = self.files().sym(file, symbol);
        // `IsTypeDeclaration`: the declared type. Otherwise the type of the symbol.
        let is_type_declaration = match decl {
            // `getTypeOfSymbol` of a function expression or a class expression is the type of the expression.
            Decl::Fn(f) => match bound.fns[f.idx()].owner {
                FnOwner::Expr(e) => return self.type_of_expr(file, e),
                _ => false,
            },
            Decl::Class(c) => match bound.class_owner[c.idx()] {
                ClassOwner::Expr(e) => return self.type_of_expr(file, e),
                ClassOwner::Stmt(_) => true,
            },
            Decl::Enum(_) | Decl::Alias(_) => true,
            // `import type a from`, `import type { a }`, `export type { a }`: the `type` of the clause, not of the specifier.
            Decl::ImportDefault(import) => hir[import].type_only,
            Decl::ImportSpec(spec) => hir
                .imports
                .iter()
                .any(|import| import.type_only && import.named.range().contains(&spec.idx())),
            Decl::ExportSpec(spec) => hir
                .exports
                .iter()
                .any(|export| export.type_only && export.items.range().contains(&spec.idx())),
            _ => false,
        };
        // `IsTypeDeclarationName`: a name that is a string literal is not one.
        let is_identifier = !matches!(hir.text.get(start as usize), Some(b'"' | b'\''));
        match decl {
            _ if !is_type_declaration || !is_identifier => self.type_of_symbol(sym),
            Decl::ImportDefault(_) | Decl::ImportSpec(_) | Decl::ExportSpec(_) => {
                self.get_declared_type_of_alias(sym)
            }
            _ => self.declared_type(sym),
        }
    }

    /// `getDeclaredTypeOfAlias`. The error type if what `alias` stands for is not a type.
    fn get_declared_type_of_alias(&mut self, alias: Sym) -> TypeId {
        match self.files().resolve_alias(alias) {
            Some(target) if self.type_flags_of_symbol(target).intersects(SymFlags::TYPE) => {
                self.declared_type(target)
            }
            _ => TypeId::ANY,
        }
    }

    /// `GetModeForUsageLocation` of `TryGetModuleSpecifierFromDeclaration`, of an import or an export.
    fn mode_of_module_specifier_of_declaration(
        &self,
        file: FileId,
        decl: Decl,
    ) -> Option<ResolutionMode> {
        let (hir, files) = (self.hir(file), self.files());
        let written = match decl {
            Decl::ImportDefault(import) | Decl::ImportNamespace(import) => hir[import].mode,
            Decl::ImportSpec(spec) => {
                hir.imports
                    .iter()
                    .find(|import| import.named.range().contains(&spec.idx()))?
                    .mode
            }
            Decl::ExportSpec(spec) => {
                let export = hir
                    .exports
                    .iter()
                    .find(|export| export.items.range().contains(&spec.idx()))?;
                if export.spec.is_none() {
                    return None;
                }
                export.mode
            }
            Decl::ExportStarAs(stmt) => match hir[stmt].kind {
                StmtKind::ExportStar { mode, .. } => mode,
                _ => return None,
            },
            Decl::ImportEquals(import) => {
                return matches!(hir[import].target, ImportEqualsTarget::Require(_))
                    .then_some(ResolutionMode::Require);
            }
            _ => return None,
        };
        Some(files.mode_of_import(file, written))
    }

    /// `getTypeOfSymbol` of the symbol the member `m` of a class, an interface or a type literal declares.
    fn type_of_member_name(&mut self, file: FileId, m: MemberId) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let member = hir[m];
        let container = match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => {
                let class = self.files().sym(file, bound.class_symbol[c.idx()]);
                if member.flags.contains(Flags::STATIC) {
                    self.type_of_symbol(class)
                } else {
                    self.declared_type(class)
                }
            }
            MemberOwner::Interface(i) => {
                let interface = self.files().sym(file, bound.interface_symbol[i.idx()]);
                self.declared_type(interface)
            }
            MemberOwner::TypeLiteral(node) => self.type_from_node(file, node),
            MemberOwner::None => return TypeId::ERROR,
        };
        // What is no property of its container has the type its own declaration gives it: `[e]` whose `e` has no type that names a
        // property, or is not written as a name (`isLateBindableAST`); `#x` where there is no class to declare it; `1n`.
        let prop = self
            .member_name(file, member.key)
            .and_then(|name| self.prop_of(container, name));
        let Some((prop, _)) = prop else {
            return self.type_of_member_declaration(file, m);
        };
        let name = prop.name;
        // `declareSymbolEx`, `mergeSymbol`, `lateBindMember`: what the symbol of that name refused has a symbol of its own.
        let in_table = match prop.source {
            PropSource::Members(ref list) => list
                .first()
                .map(|&(of, first)| (of, MemberDeclaration::Member(first))),
            PropSource::Parameter(of, parameter) => {
                Some((of, MemberDeclaration::Parameter(parameter)))
            }
            _ => None,
        };
        let has_own_symbol = match in_table {
            Some(first) => !self
                .declarations_of_member(file, MemberDeclaration::Member(m))
                .contains(&first),
            // Put together of declarations that have type parameters of their own: what the binder says. `prototype`, which
            // `bindClassLikeDeclaration` declares without a declaration, refuses a late bound member too.
            None => {
                bound.is_member_in_no_table(MemberDeclaration::Member(m))
                    || name == known::prototype
                        && member.flags.contains(Flags::STATIC)
                        && flags_of_member(&member)
                            .is_some_and(|(_, excludes)| excludes & member_flags::PROPERTY != 0)
            }
        };
        let prop = if has_own_symbol {
            let mut flags = PropFlags::empty();
            if member.flags.contains(Flags::OPTIONAL) {
                flags |= PropFlags::OPTIONAL;
            }
            if member.kind == MemberKind::Method {
                flags |= PropFlags::METHOD;
            }
            Prop {
                name,
                flags,
                source: PropSource::Members(MemberList::One((file, m))),
                mapper: prop.mapper,
            }
        } else {
            prop
        };
        // `getTypeOfSymbol` of the symbol the member declares, which is not instantiated: `this` is the type parameter.
        self.type_of_prop(&prop, MapperId::IDENTITY)
    }

    /// `getTypeOfSymbol` of the symbol of `p`, a member of an object literal or a JSX attribute.
    fn type_of_literal_member_symbol(&mut self, file: FileId, p: PropId) -> TypeId {
        let hir = self.hir(file);
        let declarations = self.bound(file).declarations_of_literal_member(p);
        let of_kind = |kind: PropKind| {
            declarations
                .iter()
                .copied()
                .find(|&declaration| hir[declaration].kind == kind)
        };
        // `getTypeOfAccessors` is asked first: the get accessor says what the property is, or else the set accessor. Otherwise
        // `getTypeOfVariableOrParameterOrPropertyWorker`: `checkPropertyAssignment`, `checkJsxAttribute` and the like of
        // `symbol.ValueDeclaration`, the first declaration (`SetValueDeclaration`). None of them widens.
        let declaration = of_kind(PropKind::Getter)
            .or_else(|| of_kind(PropKind::Setter))
            .unwrap_or(declarations[0]);
        self.type_of_literal_prop(file, declaration)
    }
}

/// What is written for a node whose type is the error type: `error` (`IntrinsicName()`) if the test has no errors, or else `any`
/// (`typeWriterWalker.hadErrorBaseline`). Whoever has the report of the test replaces it.
pub const ERROR_TYPE_TEXT: &str = "\u{1}error";
