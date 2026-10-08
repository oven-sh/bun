//! `getTypeOfNode`: the type at a node of a file that has been checked.

use super::super::*;
use super::visited::VisitedKind;
use super::{NodeRef, Services};
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, SymbolId, flags_of_member};
use crate::node::{Kind, Node, NodeData, Part};

impl Checker<'_, '_> {
    /// `getTypeOfNode`
    ///
    /// `kind`: what `visited_kind` says that the node is. `start`: where it starts.
    pub(in crate::check) fn get_type_of_visited_node(
        &mut self,
        file: FileId,
        kind: VisitedKind,
        start: u32,
    ) -> TypeId {
        let hir = self.hir(file);
        // Semantic queries are not answered inside a `with` block.
        if hir.is_in_with(start) {
            return TypeId::ERROR;
        }
        match kind {
            VisitedKind::Expression(e)
            | VisitedKind::Parenthesized(e, _)
            | VisitedKind::AccessName(e) => self.type_of_visited_expression(file, e),
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
                self.type_of_declaration_name(file, decl, symbol, start)
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
                self.type_of_literal_in_computed_name(file, hir[m].key, start)
            }
            VisitedKind::LiteralInPropertyName(p) => {
                self.type_of_literal_in_computed_name(file, hir[p].key, start)
            }
            VisitedKind::LiteralInBindingPropertyName(p) => {
                self.type_of_literal_in_computed_name(file, hir[p].key, start)
            }
            VisitedKind::LiteralInEnumMemberName(m) => {
                self.type_of_literal_in_computed_name(file, PropKey::Name(hir[m].name), start)
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
        // `getResolvedSymbol`: `NodeIsMissing`
        if matches!(
            hir[e].kind,
            ExprKind::Missing | ExprKind::Ident(known::empty)
        ) {
            return TypeId::ERROR;
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
        let text = std::str::from_utf8(self.atoms().bytes(name)).ok();
        match text.and_then(|text| text.parse::<f64>().ok()) {
            Some(value) => self.number_literal(value, false),
            None => TypeId::ERROR,
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
            .declared_member_name(file, member.key)
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

    /// `getTypeOfSymbol(getSymbolOfDeclaration(p))` for `p`, a member of an object literal or a JSX
    /// attribute.
    fn type_of_literal_member_symbol(&mut self, file: FileId, p: PropId) -> TypeId {
        // `getTypeOfAccessors` takes precedence: the get accessor determines the type of the
        // property, or else the set accessor. Otherwise
        // `getTypeOfVariableOrParameterOrPropertyWorker`: `checkPropertyAssignment`,
        // `checkJsxAttribute` and the like for `symbol.ValueDeclaration`, the first declaration
        // (`SetValueDeclaration`). None of them widens.
        let declaration = self
            .accessor_of_literal(file, p, PropKind::Getter)
            .or_else(|| self.accessor_of_literal(file, p, PropKind::Setter))
            .unwrap_or_else(|| self.first_declaration_of_literal_member(file, p));
        self.get_type_of_literal_member(file, declaration)
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `getTypeOfExpression`, called after `file` has been checked. tsgo does not memoize `checkExpression`, so `e` and its
    /// subexpressions are checked again in the normal check mode with no contextual type pushed. Only what tsgo caches is reused:
    /// resolved signatures, symbol types, and the parameter and return types of functions. The contextual type of an argument
    /// therefore comes from the resolved signature, which decides again which literal types are preserved
    /// (`isLiteralOfContextualType`) and what is a const context (`isConstContext`), and a generic function keeps its declared
    /// type (`instantiateTypeWithSingleGenericCallSignature`). The cached type of an argument is the one from which the type
    /// arguments of its call were inferred.
    pub(in crate::check) fn get_type_of_expression_after_check(&mut self, file: FileId, e: ExprId) -> TypeId {
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
    pub(in crate::check) fn get_type_of_literal_member(&mut self, file: FileId, p: PropId) -> TypeId {
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
    pub(in crate::check) fn is_flow_analysis_left_disabled(&mut self, file: FileId) -> bool {
        // A walk nests at most once per flow node.
        if self.bound(file).flow_places <= crate::check::flow::MAX_FLOW_DEPTH {
            return false;
        }
        (0..self.hir(file).exprs.len() as u32).map(ExprId).any(|e| {
            self.p.flows_too_deep.get(&self.task, &(file, e)).is_some()
                && self.function_or_module_block_of(file, e) == crate::node::Node::FILE
        })
    }

    /// `resolveEntityName`, `ignoreErrors`, `dontResolveAlias`
    pub(in crate::check) fn resolve_entity(
        &mut self,
        file: FileId,
        scope: crate::bind::ScopeId,
        names: &[Atom],
        meaning: SymFlags,
    ) -> Option<Sym> {
        let files = self.files();
        files.resolve_entity_with(file, scope, names, meaning, false, self)
    }
}

impl Services<'_, '_, '_> {
    /// `getTypeAtLocation`, `getTypeOfNode`
    pub fn type_at_location(&mut self, node: NodeRef) -> TypeId {
        let Some((hir, at)) = self.valid(node) else {
            return TypeId::ERROR;
        };
        let file = node.file;
        if at == Node::FILE {
            // `isSourceFile(node) && !isExternalModule(node)`
            let files = self.c.files();
            return match files.module(file).is_module() {
                true => self.c.type_of_symbol(files.file_symbol(file)),
                false => TypeId::ERROR,
            };
        }
        let start = hir.start(at);
        // Semantic queries are not answered inside a `with` block, nor for what is reparsed from a
        // JSDoc comment.
        if hir.is_in_with(start) || hir.is_in_jsdoc(start) {
            return TypeId::ERROR;
        }
        let kind = hir.kind(at);
        if hir.is_part_of_type_node(at) {
            return self.type_of_part_of_type_node(node);
        }
        let is_visited = hir.is_expression_node(at) || kind == Kind::Identifier || hir.is_declaration_name(at);
        if is_visited && let Some(visited) = self.visited_kind(node) {
            return self.c.get_type_of_visited_node(file, visited, start);
        }
        // The `ExpressionWithTypeArguments` after the `extends` of a class: the base type.
        if at.part() == Some(Part::Base) {
            let class = self.c.class_sym(file, hir.class_of(at.row()));
            return match self.c.base_types(class).first() {
                Some(&base) => {
                    let this = self.c.intern(TypeData::ThisParam(class));
                    self.c.type_with_this_argument(base, this)
                }
                None => TypeId::ERROR,
            };
        }
        let bound = self.c.bound(file);
        let declared_type_of = |services: &mut Self, symbol: SymbolId| match symbol.is_some() {
            true => services.c.declared_type(services.c.files().sym(file, symbol)),
            false => TypeId::ERROR,
        };
        let type_of = |services: &mut Self, symbol: SymbolId| match symbol.is_some() {
            true => services.c.type_of_symbol(services.c.files().sym(file, symbol)),
            false => TypeId::ERROR,
        };
        match hir.data(at) {
            // `isTypeDeclaration`: the declared type.
            NodeData::Stmt(s) => match hir[s].kind {
                StmtKind::Class(c) => return declared_type_of(self, bound.class_symbol[c.idx()]),
                StmtKind::Interface(i) => return declared_type_of(self, bound.interface_symbol[i.idx()]),
                StmtKind::TypeAlias(a) => return declared_type_of(self, bound.alias_symbol[a.idx()]),
                StmtKind::Enum(e) => return declared_type_of(self, bound.enum_symbol[e.idx()]),
                StmtKind::Module(m) => return type_of(self, bound.module_symbol[m.idx()]),
                StmtKind::ImportEquals(i) => return type_of(self, bound.symbol_of_declaration(Decl::ImportEquals(i))),
                _ => {}
            },
            NodeData::TypeParam(p) => return declared_type_of(self, bound.type_param_symbol[p.idx()]),
            NodeData::EnumMember(m) => return type_of(self, bound.enum_member_symbol[m.idx()]),
            NodeData::ImportSpec(s) => {
                let symbol = bound.symbol_of_declaration(Decl::ImportSpec(s));
                return match hir[hir[s].import].type_only {
                    true => declared_type_of(self, symbol),
                    false => type_of(self, symbol),
                };
            }
            NodeData::ExportSpec(s) => {
                let symbol = bound.symbol_of_declaration(Decl::ExportSpec(s));
                return match hir[hir[s].export].type_only {
                    true => declared_type_of(self, symbol),
                    false => type_of(self, symbol),
                };
            }
            // `isBindingPattern`, and a declaration whose name is one:
            // `getTypeForVariableLikeDeclaration`.
            NodeData::Pat(pat) => return self.c.type_of_pat(file, pat),
            NodeData::VarDecl(d) if !matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                return self.c.type_of_pat(file, hir[d].pat);
            }
            NodeData::PatProp(p) if hir[p].value.is_some() && !matches!(hir[hir[p].value].kind, PatKind::Ident(_)) => {
                return self.c.type_of_pat(file, hir[p].value);
            }
            NodeData::PatElem(e) if hir[e].pat.is_some() && !matches!(hir[hir[e].pat].kind, PatKind::Ident(_)) => {
                return self.c.type_of_pat(file, hir[e].pat);
            }
            NodeData::Part(Part::ImportClause, row) => {
                if let NodeData::Stmt(s) = hir.data(row)
                    && let StmtKind::Import(i) = hir[s].kind
                {
                    let symbol = bound.symbol_of_declaration(Decl::ImportDefault(i));
                    return match hir[i].type_only {
                        true => declared_type_of(self, symbol),
                        false => type_of(self, symbol),
                    };
                }
            }
            NodeData::Part(Part::NamedBindings, row) => {
                if let NodeData::Stmt(s) = hir.data(row)
                    && let StmtKind::Import(i) = hir[s].kind
                    && hir.kind(at) == Kind::NamespaceImport
                {
                    return type_of(self, bound.symbol_of_declaration(Decl::ImportNamespace(i)));
                }
            }
            _ => {}
        }
        // `isDeclaration`: `getTypeOfSymbol(getSymbolOfDeclaration(node))`
        self.c.iso_type_of_declared(file, at).unwrap_or(TypeId::ERROR)
    }

    /// `getTypeFromTypeNode` of what `isPartOfTypeNode` holds for.
    fn type_of_part_of_type_node(&mut self, node: NodeRef) -> TypeId {
        let Some((hir, at)) = self.valid(node) else {
            return TypeId::ERROR;
        };
        let file = node.file;
        match hir.data(at) {
            NodeData::Type(t) => {
                // `isReadonlyTypeOperator(node.parent)`: the `T[]` of `readonly T[]` is that type.
                let t = match (hir[t].kind, hir.data(hir.parent(at))) {
                    (TypeNodeKind::Array(_) | TypeNodeKind::Tuple(_), NodeData::Type(operator))
                        if matches!(hir[operator].kind, TypeNodeKind::Readonly(_)) =>
                    {
                        operator
                    }
                    _ => t,
                };
                let ty = self.c.type_from_node(file, t);
                // `tryGetClassImplementingOrExtendingExpressionWithTypeArguments`
                let clause = hir.parent(at);
                if hir.kind(at) == Kind::ExpressionWithTypeArguments
                    && hir.kind(clause) == Kind::HeritageClause
                    && hir.kind(hir.parent(clause)).is_class_like()
                {
                    let class = self.c.class_sym(file, hir.class_of(hir.parent(clause)));
                    let this = self.c.intern(TypeData::ThisParam(class));
                    return self.c.type_with_this_argument(ty, this);
                }
                ty
            }
            NodeData::TypeParam(p) => self.c.type_param(file, p),
            // A keyword that is the literal of a `LiteralType`, `null`.
            NodeData::Part(Part::Literal | Part::ConstType, row) => match hir.data(row) {
                NodeData::Type(t) => self.c.type_from_node(file, t),
                _ => TypeId::ERROR,
            },
            NodeData::Expr(e) if matches!(hir[e].kind, ExprKind::Null) => {
                let ty = self.c.get_type_of_expression_after_check(file, e);
                self.c.regular(ty)
            }
            // An identifier or a qualified name: the declared type of what it refers to.
            _ => match self.symbol_at_location(node).and_then(|symbol| self.sym_of(symbol)) {
                Some(symbol) => {
                    let target = self.c.files().resolve_alias_if_needed(symbol).unwrap_or(symbol);
                    self.c.declared_type(target)
                }
                None => TypeId::ERROR,
            },
        }
    }
}
