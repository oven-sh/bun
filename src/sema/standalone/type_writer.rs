//! The type at every expression and declaration name of a file: the content TypeScript's test
//! harness writes into `.types` baselines (`typeWriterWalker`, `GetTypeAtLocation`).

use super::enclosing_declaration::Enclosing;
use super::visit_node::{VisitedKind, VisitedNode};
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, SymbolId, flags_of_member};
use crate::node::{Kind, Node, NodeData, Part};

/// `typeWriterResult`
pub struct TypeAtLocation {
    pub start: u32,
    pub end: u32,
    pub type_text: String,
    /// For diagnosing the source of a difference.
    pub kind: VisitedKind,
}

/// State carried from node to node during the type walk of a file.
struct TypeWalk {
    /// The last type printed for an expression, and its text. The parentheses around an expression
    /// and the name of a property access reuse it.
    text_of_expr: Vec<Option<(TypeId, String)>>,
}

impl Checker<'_, '_> {
    /// `typeWriterWalker.getTypes`. The file must have been checked, as in the harness.
    pub fn types_at_locations(&mut self, file: FileId) -> Vec<TypeAtLocation> {
        self.flow_analysis_disabled_in = self.is_flow_analysis_left_disabled(file).then_some(file);
        let hir = self.hir(file);
        let mut walk = TypeWalk {
            text_of_expr: vec![None; hir.exprs.len()],
        };
        let nodes = self.visited_nodes(file);
        let mut results = Vec::with_capacity(nodes.len());
        for node in nodes {
            self.write_type_of_visited_node(file, node, &mut walk, &mut results);
        }
        self.rechecked_exprs.clear();
        self.rechecked_members.clear();
        results
    }

    /// The position and the kind of each node of `file` whose type is the error type: the walk of
    /// `types_at_locations` without the printing. TypeScript produces the error type only where it
    /// reports an error or receives an error type as input, so in a file without errors each of
    /// these is a bug. Empty for a file whose semantic errors are not reported, or only partly
    /// reported. The file must have been checked.
    pub fn error_types_at_locations(&mut self, file: FileId) -> Vec<(u32, String)> {
        if !self.reports_semantic_errors(file) || self.is_plain_js(file) {
            return Vec::new();
        }
        self.flow_analysis_disabled_in = self.is_flow_analysis_left_disabled(file).then_some(file);
        let mut found = Vec::new();
        for node in self.visited_nodes(file) {
            if self.is_omitted_from_types(file, node.kind) {
                continue;
            }
            let ty = self.get_type_of_visited_node(file, node);
            if self.is_error_type(ty) && !self.is_error_type_printed_as_any(file, node.node) {
                found.push((node.start, format!("{:?}", node.kind)));
            }
        }
        self.rechecked_exprs.clear();
        self.rechecked_members.clear();
        found
    }

    /// `writeTypeOrSymbol`, in the walk for types.
    fn write_type_of_visited_node(
        &mut self,
        file: FileId,
        node: VisitedNode,
        walk: &mut TypeWalk,
        results: &mut Vec<TypeAtLocation>,
    ) {
        if self.is_omitted_from_types(file, node.kind) {
            return;
        }
        let ty = self.get_type_of_visited_node(file, node);
        let type_text = if ty == TypeId::ERROR && self.is_error_type_printed_as_any(file, node.node)
        {
            "any".to_owned()
        } else {
            self.type_text_of_visited_node(file, node, ty, walk)
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
        VisitedNode { node, kind, .. }: VisitedNode,
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
        let hir = self.hir(file);
        let enclosing_declaration = Enclosing {
            variable: match hir.data(hir.parent(node)) {
                NodeData::VarDecl(declaration) => declaration,
                _ => VarDeclId::NONE,
            },
            ..Enclosing::at_scope(file, scope)
        };
        let text = self.type_to_string_for_baseline_with(ty, Some(enclosing_declaration));
        let text = crate::messages::text(&text);
        self.enclosing_module_specifier_mode = None;
        if let Some(index) = repeated {
            walk.text_of_expr[index] = Some((ty, text.clone()));
        }
        text
    }

    /// Whether `writeTypeOrSymbol` omits the node from the type walk.
    fn is_omitted_from_types(&self, file: FileId, kind: VisitedKind) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match kind {
            VisitedKind::Expression(e) => match hir[e].kind {
                // `IsPartOfTypeNode` treats the keyword `null` as a type wherever it appears.
                ExprKind::Null => true,
                // An assertion whose type node is reparsed from a `@type` or `@satisfies` tag.
                ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => {
                    ty.is_some() && hir.is_in_jsdoc(hir[ty].pos)
                }
                ExprKind::AsConst(_) => hir.is_js,
                _ => false,
            },
            // `GetMeaningFromDeclaration(node.Parent)` lacks `SemanticMeaningValue`. The name of a
            // type alias is printed anyway, and that of a namespace if it is
            // `ModuleInstanceStateInstantiated`.
            VisitedKind::DeclarationName(Decl::Interface(_) | Decl::TypeParam(_), _) => true,
            VisitedKind::DeclarationName(Decl::Module(m), _) => {
                matches!(hir[m].name, ModuleName::Ident(_))
                    && bound.module_instance_state[m.idx()] != ModuleInstanceState::Instantiated
            }
            // `IsPartOfTypeNode`: `const` is a type reference, and a `TypePredicate` a type node.
            VisitedKind::ConstOfAsConst(_) | VisitedKind::TypePredicateParameter(_) => true,
            // `isPartOfTypeNodeInParent`: of `A.B.C` only `C` and the whole name are direct
            // children of a type node.
            // In a heritage clause the same applies to the property accesses
            // (`isPartOfTypeExpressionWithTypeArguments`).
            VisitedKind::TypeReferenceName(node, index)
            | VisitedKind::HeritageClauseName(node, index)
            | VisitedKind::HeritageClausePropertyAccess(node, index) => {
                !matches!(hir[node].kind, TypeNodeKind::Ref { name, .. } if index as usize + 1 != name.len())
            }
            // The `b` of `typeof import("m").a.b` is not: `isPartOfTypeNodeInParent` excludes an
            // `ImportType` with `IsTypeOf`.
            VisitedKind::ImportTypeQualifierName(node, index) => {
                matches!(hir[node].kind, TypeNodeKind::Import { name, is_typeof: false, .. }
                    if index as usize + 1 == name.len())
            }
            _ => false,
        }
    }

    /// The exceptions of `writeTypeOrSymbol`: whether the error type of the node is printed as
    /// `any` even in a test without errors.
    fn is_error_type_printed_as_any(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        let parent = hir.parent(node);
        match hir.kind(parent) {
            // `IsBindingElement`, `IsPropertyAccessOrQualifiedName`, `IsMetaProperty`, of `node.Parent`; the names of specifiers
            // (`isImportStatementName`, `isExportStatementName`)
            Kind::BindingElement
            | Kind::PropertyAccessExpression
            | Kind::QualifiedName
            | Kind::MetaProperty
            | Kind::ImportSpecifier
            | Kind::ExportSpecifier => true,
            // `IsLabelName`
            _ if node.part() == Some(Part::Label) => true,
            // `IsGlobalScopeAugmentation(node.Parent)`
            Kind::ModuleDeclaration => matches!(hir.data(parent), NodeData::Stmt(s)
                if matches!(hir[s].kind, StmtKind::Module(m) if matches!(hir[m].name, ModuleName::Global))),
            // `isImportStatementName`
            Kind::ImportClause | Kind::ImportEqualsDeclaration => hir.name(parent) == node,
            // `isExportStatementName`
            Kind::ExportAssignment => hir.expression(parent) == node,
            // `isIntrinsicJsxTag`
            _ => matches!(hir.data(node), NodeData::Expr(tag)
                if hir.is_jsx_tag_name(node) && self.jsx_intrinsic_tag_name(file, tag).is_some()),
        }
    }

    /// `getTypeOfNode`, preceded by the special case of `writeTypeOrSymbol` for the node after the
    /// `extends` of a class.
    fn get_type_of_visited_node(&mut self, file: FileId, node: VisitedNode) -> TypeId {
        let hir = self.hir(file);
        // Semantic queries are not answered inside a `with` block.
        if hir.is_in_with(node.start) {
            return TypeId::ERROR;
        }
        match node.kind {
            VisitedKind::Expression(e)
            | VisitedKind::Parenthesized(e, _)
            | VisitedKind::AccessName(e) => {
                // `IsExpressionWithTypeArgumentsInClassExtendsClause(node.Parent)`: the base type, unless it is `any` or there is none.
                let parent = hir.parent(node.node);
                // The base expressions of a class after the first are not wrapped in an
                // `ExpressionWithTypeArguments`.
                if matches!(parent.part(), Some(Part::Base | Part::Extends)) {
                    let class = self.class_sym(file, hir.class_of(parent.row()));
                    if let Some(&base) = self.base_types(class).first()
                        && !base.is_any()
                    {
                        let this = self.intern(TypeData::ThisParam(class));
                        return self.type_with_this_argument(base, this);
                    }
                }
                self.type_of_visited_expression(file, e)
            }
            VisitedKind::BindingName(pat) => self.type_of_binding_name(file, pat),
            // `IsJsxTagName`: the identifier is an expression (`checkIdentifier`). The name `a-b`
            // never resolves.
            VisitedKind::JsxIntrinsicTagName(_, tag) => match hir[tag].kind {
                ExprKind::Ident(_) => {
                    let ty = self.type_of_expr(file, tag);
                    self.regular(ty)
                }
                _ => TypeId::ERROR,
            },
            VisitedKind::DeclarationName(decl, symbol) => {
                self.type_of_declaration_name(file, decl, symbol, node.start)
            }
            // `getImmediateAliasedSymbol`: the type of the symbol the specifier aliases.
            VisitedKind::SpecifierPropertyName(_, symbol) => {
                let sym = self.files().sym(file, symbol);
                self.type_of_symbol(sym)
            }
            VisitedKind::MemberName(m) => self.type_of_member_name(file, m),
            // `declareSymbolEx`: a declaration without a name has its own symbol.
            VisitedKind::PropertyName(p) if matches!(hir[p].key, PropKey::None) => {
                self.get_type_of_literal_member(file, p)
            }
            VisitedKind::PropertyName(p) => self.type_of_literal_member_symbol(file, p),
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
            VisitedKind::ThisParameter(f) => self.type_of_this_parameter(file, f),
            // `getRegularTypeOfExpression` of the access, and of its final name
            // (`isRightSideOfQualifiedNameOrPropertyAccess`).
            VisitedKind::HeritageClauseName(reference, index)
            | VisitedKind::HeritageClausePropertyAccess(reference, index) => {
                let TypeNodeKind::Ref { name, .. } = hir[reference].kind else {
                    return TypeId::ERROR;
                };
                let names: Vec<Atom> = hir.texts(name).take(index as usize + 1).collect();
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
            | VisitedKind::ModuleSpecifier(_)
            | VisitedKind::ImportDeferName(_)
            | VisitedKind::ImportAttributeName(_)
            | VisitedKind::JsxNamespacedNamePart
            | VisitedKind::ConstOfAsConst(_)
            | VisitedKind::TypePredicateParameter(_) => TypeId::ERROR,
        }
    }

    /// `getTypeOfNode` of an expression, of the parentheses around it, and of the final name of a
    /// property access (`isRightSideOfQualifiedNameOrPropertyAccess`).
    fn type_of_visited_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
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
        let ty = match hir[e].kind {
            // `checkSpreadExpression`
            ExprKind::Spread(operand) => {
                let iterable = self.get_type_of_expression_after_check(file, operand);
                self.iterated_type_if_any(iterable, false)
                    .unwrap_or(TypeId::ANY)
            }
            _ => self.get_type_of_expression_after_check(file, e),
        };
        self.regular(ty)
    }

    /// `getTypeOfSymbol` of the symbol the name `pat` declares.
    fn type_of_binding_name(&mut self, file: FileId, pat: PatId) -> TypeId {
        let (declared_in, first) = self.value_declaration_of_variable_name(file, pat);
        let ty = self.type_of_pat(declared_in, first);
        // `bindVariableDeclarationOrBindingElement`: `const x = require(..)` declares an alias.
        // `getTypeOfNode` of its name is the type of the alias target.
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

    /// The type of the string or number literal at `start`, which is the bracketed form of the name
    /// `key`.
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
        match self.atoms().text(name).parse::<f64>() {
            Ok(value) => self.number_literal(value, false),
            Err(_) => TypeId::ERROR,
        }
    }

    /// `getSymbolOfPartOfRightHandSideOfImportEquals`: in `import x = a.b.c`, `a` and `a.b` have
    /// the namespace meaning, and so does the `a` of `import x = a`. `getTypeOfNode`: the declared
    /// type of the symbol a name resolves to, or else the type of that symbol.
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
        let names: Vec<Atom> = hir.texts(entity).collect();
        let meaning = if names.len() == 1 || index + 1 < names.len() {
            SymFlags::NAMESPACE
        } else {
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
        };
        let scope = bound.import_equals_scope[import.idx()];
        let symbol = self
            .files()
            .resolve_entity(file, scope, &names[..=index], meaning);
        let ty = match symbol {
            // `getDeclaredTypeOfEnumMember`
            Some(symbol)
                if self.files().resolve_alias(symbol).is_some_and(|target| {
                    self.files().flags(target).contains(SymFlags::ENUM_MEMBER)
                }) =>
            {
                self.type_of_symbol(symbol)
            }
            Some(symbol) => {
                let declared = self.declared_type(symbol);
                if declared == TypeId::ERROR || declared == TypeId::UNRESOLVED {
                    self.type_of_symbol(symbol)
                } else {
                    declared
                }
            }
            None => TypeId::ERROR,
        };
        // A single name has the namespace meaning, and its type is `any` only on error.
        if names.len() == 1 && ty.is_any() {
            TypeId::ERROR
        } else {
            ty
        }
    }

    /// `getTypeOfNode` of the bare name in `export = a` or `export default a`, which
    /// `IsInExpressionContext` does not count as an expression
    /// (`isInRightSideOfImportOrExportAssignment`): the declared type of the symbol it resolves to,
    /// or else the type of that symbol.
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
        Some(if self.files().flags(symbol).intersects(SymFlags::TYPE) {
            self.declared_type(symbol)
        } else {
            // The target of a namespace import can be a copy of the module (`resolveESModuleSymbol`): its type is that of the alias.
            let written = bound
                .expr_scope
                .get(&e)
                .and_then(|&scope| files.resolve_name(file, scope, name, meaning));
            self.type_of_symbol(written.unwrap_or(symbol))
        })
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
            Decl::ImportSpec(spec) => hir[hir[spec].import].type_only,
            Decl::ExportSpec(spec) => hir[hir[spec].export].type_only,
            _ => false,
        };
        // `IsTypeDeclarationName`: a name that is a string literal is not one.
        // `parseImportSpecifier` converts it to an identifier.
        let is_identifier = matches!(decl, Decl::ImportSpec(_))
            || !matches!(hir.text.get(start as usize), Some(b'"' | b'\''));
        if is_type_declaration && is_identifier {
            self.declared_type(sym)
        } else {
            self.type_of_symbol(sym)
        }
    }

    /// `GetModeForUsageLocation` of `TryGetModuleSpecifierFromDeclaration`, for an import or an
    /// export.
    fn mode_of_module_specifier_of_declaration(
        &self,
        file: FileId,
        decl: Decl,
    ) -> Option<ResolutionMode> {
        let (hir, files) = (self.hir(file), self.files());
        let written = match decl {
            Decl::ImportDefault(import) | Decl::ImportNamespace(import) => hir[import].mode,
            Decl::ImportSpec(spec) => hir[hir[spec].import].mode,
            Decl::ExportSpec(spec) => {
                let export = &hir[hir[spec].export];
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
        // A member that is not a property of its container has the type of its own declaration:
        // `[e]` whose `e` has no type usable as a property name, or is not syntactically a name
        // (`isLateBindableAST`); `#x` outside a class; `1n`.
        let prop = self
            .member_name(file, member.key)
            .and_then(|name| self.prop_ref(container, name))
            .map(|(prop, mapper)| (prop.clone_in(self.arena), mapper));
        let own = PropSource::Symbol(self.symbol_of_member(file, m));
        let own_symbol = |name: Atom, mapper: MapperId| {
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
                source: own.clone_in(self.arena),
                mapper,
            }
        };
        let Some((prop, _)) = prop else {
            let prop = own_symbol(Atom::NONE, MapperId::IDENTITY);
            return self.type_of_prop(&prop, MapperId::IDENTITY);
        };
        let name = prop.name;
        // `declareSymbolEx`, `mergeSymbol`, `lateBindMember`: a declaration that the symbol of that
        // name rejected has its own symbol.
        let has_own_symbol = match Self::value_declaration(&prop) {
            Some(in_table @ PropSource::Symbol(_)) => *in_table != own,
            // Put together of declarations that have type parameters of their own: what the binder says. `prototype`, which
            // `bindClassLikeDeclaration` declares without a declaration, refuses a late bound member too.
            _ => {
                bound.is_member_in_no_table(m)
                    || name == known::prototype
                        && member.flags.contains(Flags::STATIC)
                        && flags_of_member(&member)
                            .is_some_and(|(_, excludes)| excludes.contains(SymFlags::PROPERTY))
            }
        };
        let prop = if has_own_symbol {
            own_symbol(name, prop.mapper)
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
        // `getTypeOfAccessors` takes precedence: the get accessor determines the type of the
        // property, or else the set accessor. Otherwise
        // `getTypeOfVariableOrParameterOrPropertyWorker`: `checkPropertyAssignment`,
        // `checkJsxAttribute` and the like for `symbol.ValueDeclaration`, the first declaration
        // (`SetValueDeclaration`). None of them widens.
        let declaration = of_kind(PropKind::Getter)
            .or_else(|| of_kind(PropKind::Setter))
            .unwrap_or(declarations[0]);
        self.get_type_of_literal_member(file, declaration)
    }
}

/// Placeholder printed for a node whose type is the error type: `error` (`IntrinsicName()`) if the
/// test has no errors, or else `any` (`typeWriterWalker.hadErrorBaseline`). The caller that has the
/// report of the test replaces it.
pub const ERROR_TYPE_TEXT: &str = "\u{1}error";

impl<'p, 's> Checker<'p, 's> {
    /// `getTypeOfExpression`, called after `file` has been checked. tsgo does not memoize `checkExpression`, so `e` and its
    /// subexpressions are checked again in the normal check mode with no contextual type pushed. Only what tsgo caches is reused:
    /// resolved signatures, symbol types, and the parameter and return types of functions. The contextual type of an argument
    /// therefore comes from the resolved signature, which decides again which literal types are preserved
    /// (`isLiteralOfContextualType`) and what is a const context (`isConstContext`), and a generic function keeps its declared
    /// type (`instantiateTypeWithSingleGenericCallSignature`). The cached type of an argument is the one from which the type
    /// arguments of its call were inferred.
    pub(super) fn get_type_of_expression_after_check(&mut self, file: FileId, e: ExprId) -> TypeId {
        // The first check, which resolves the calls enclosing `e`.
        self.type_of_expr(file, e);
        let outer = self.begin_recheck();
        let ty = match self.quick_type_of_expr(file, e) {
            Some(quick) => quick,
            None => self.check_expression_ex(file, e, CheckMode::empty()),
        };
        self.end_recheck(outer);
        ty
    }

    /// `getTypeOfSymbol` for a member of an object literal or a JSX attribute whose `symbol.ValueDeclaration` is `p`. The first
    /// request runs `checkPropertyAssignment`, `checkJsxAttribute` or the equivalent. `checkObjectLiteral` does not request it.
    pub(super) fn get_type_of_literal_member(&mut self, file: FileId, p: PropId) -> TypeId {
        // `checkShorthandPropertyAssignment(declaration, true)`: for `{ a = 1 }` the name is
        // checked.
        let hir = self.hir(file);
        if hir[p].kind == PropKind::Shorthand
            && let ExprKind::Assign { target, .. } = hir[hir[p].value].kind
        {
            return self.type_of_expr(file, target);
        }
        self.type_of_literal_prop(file, p);
        let mode_outside = std::mem::replace(&mut self.mode_of_recheck, CheckMode::empty());
        let outer = self.begin_recheck();
        let ty = self.check_literal_member(file, p);
        self.end_recheck(outer);
        self.mode_of_recheck = mode_outside;
        ty
    }

    /// Whether `flowAnalysisDisabled` is still set after `file` has been checked. `checkBlock` resets it at the end of a function
    /// or module block, so it only stays set for a reference outside any such block.
    pub(super) fn is_flow_analysis_left_disabled(&mut self, file: FileId) -> bool {
        // A walk nests at most once per flow node.
        if self.bound(file).flow_places <= super::flow::MAX_FLOW_DEPTH {
            return false;
        }
        (0..self.hir(file).exprs.len() as u32).map(ExprId).any(|e| {
            self.p
                .flows_too_deep
                .get(&mut self.task, &(file, e))
                .is_some()
                && self.function_or_module_block_of(file, e) == crate::node::Node::FILE
        })
    }

    /// `resolveEntityName`, `ignoreErrors`, `dontResolveAlias`
    pub(super) fn resolve_entity(
        &mut self,
        file: FileId,
        scope: crate::bind::ScopeId,
        names: &[Atom],
        meaning: SymFlags,
    ) -> Option<Sym> {
        let files = self.files();
        let lookup = &mut |_, held, meaning| self.get_symbol(held, meaning);
        files.resolve_entity_with(file, scope, names, meaning, false, lookup)
    }
}
