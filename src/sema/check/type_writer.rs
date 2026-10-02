//! The type at every expression and declaration name of a file: what TypeScript's test harness writes into `.types` baselines
//! (`typeWriterWalker`, `GetTypeAtLocation`).

use super::visit_node::{VisitedKind, VisitedNode};
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymbolId};

/// `typeWriterResult`
pub struct TypeAtLocation {
    pub start: u32,
    pub end: u32,
    pub type_text: String,
    /// What kind of node it is, for telling apart where a difference comes from.
    pub kind: &'static str,
}

/// What the walk for the types of a file keeps from one node to the next.
struct TypeWalk {
    /// `literal_types_in_resolved_context`
    literal_types: FxHashMap<ExprId, TypeId>,
    /// The type that was written last for an expression, and how it is written. The parentheses around an expression and the name of a
    /// property access repeat it.
    text_of_expr: Vec<Option<(TypeId, String)>>,
}

impl Checker<'_> {
    /// `typeWriterWalker.getTypes`, in no particular order. The file must have been checked, as in the harness.
    pub fn types_at_locations(&mut self, file: FileId) -> Vec<TypeAtLocation> {
        let hir = self.hir(file);
        let mut results = Vec::with_capacity(hir.exprs.len() * 2);
        let (literal_types, literal_prop_types) = self.literal_types_in_resolved_context(file);
        let mut walk = TypeWalk {
            literal_types,
            text_of_expr: vec![None; hir.exprs.len()],
        };
        for node in self.visited_nodes(file) {
            self.write_type_of_visited_node(file, node, &mut walk, &mut results);
        }
        let listed = results.len();
        self.types_at_intrinsic_jsx_tag_names(file, &mut results);
        self.types_at_declaration_names(file, &mut results);
        self.types_at_namespace_export_names(file, &mut results);
        self.types_at_dynamic_member_names(file, &mut results);
        self.types_at_tagged_template_literals(file, &mut results);
        self.types_at_ambient_module_names(file, &mut results);
        self.types_at_expression_declaration_names(file, &mut results);
        self.types_at_member_names(file, &mut results);
        self.types_at_unbound_member_names(file, &mut results);
        self.types_at_property_names(file, &mut results);
        self.types_at_unbound_property_names(file, &mut results);
        self.remove_string_property_names_of_specifiers(file, &mut results);
        self.extend_jsx_attribute_names(file, &mut results);
        // `getTypeOfSymbol` of the property first checks its initializer when the writer asks, under the same contextual type.
        for (&p, &ty) in &literal_prop_types {
            let ty = self.widened(ty);
            let scope = self.enclosing_scope_of_property(file, p);
            let type_text = self.type_to_string_for_baseline_at(ty, file, scope);
            for result in results
                .iter_mut()
                .filter(|result| result.kind == "property-name" && result.start == hir[p].pos)
            {
                result.type_text.clone_from(&type_text);
            }
        }
        // `getTypeOfNode`: no semantic question is answered within a `with` block. `get_type_of_visited_node` has that for its nodes.
        for found in results[listed..].iter_mut() {
            if hir.is_in_with(found.start) {
                found.type_text = ERROR_TYPE_TEXT.to_owned();
            }
        }
        // `forEachASTNode` leaves out what is reparsed from a JSDoc comment, and a comment is no child of a node.
        results.retain(|found| !hir.is_in_jsdoc(found.start));
        self.remove_uninstantiated_namespace_names(file, &mut results);
        self.write_any_for_exempt_error_types(file, &mut results);
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
        if self.is_part_of_type_node(file, node.kind) || self.is_reparsed_assertion(file, node.kind)
        {
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
            kind: if node.start == node.end {
                "missing"
            } else {
                node.kind.name()
            },
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
        let text = self.type_to_string_for_baseline_at(ty, file, scope);
        if let Some(index) = repeated {
            walk.text_of_expr[index] = Some((ty, text.clone()));
        }
        text
    }

    /// `writeTypeOrSymbol`: an assertion whose type node is reparsed from a `@type` or `@satisfies` tag is not written.
    fn is_reparsed_assertion(&self, file: FileId, kind: VisitedKind) -> bool {
        let hir = self.hir(file);
        let VisitedKind::Expression(e) = kind else {
            return false;
        };
        match hir[e].kind {
            ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => {
                ty.is_some() && hir.is_in_jsdoc(hir[ty].pos)
            }
            ExprKind::AsConst(_) => hir.is_js,
            _ => false,
        }
    }

    /// `IsPartOfTypeNode`
    fn is_part_of_type_node(&self, file: FileId, kind: VisitedKind) -> bool {
        let hir = self.hir(file);
        match kind {
            // It takes the keyword `null` for a type wherever it is written.
            VisitedKind::Expression(e) => matches!(hir[e].kind, ExprKind::Null),
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
            VisitedKind::Expression(e) => self
                .hir(file)
                .parens
                .binary_search_by_key(&e.0, |paren| paren.0.0)
                .is_err(),
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
            VisitedKind::LiteralInMemberName(m) => {
                self.type_of_literal_in_computed_name(file, hir[m].key, node.start)
            }
            VisitedKind::LiteralInPropertyName(p) => {
                self.type_of_literal_in_computed_name(file, hir[p].key, node.start)
            }
            VisitedKind::LiteralInBindingPropertyName(p) => {
                self.type_of_literal_in_computed_name(file, hir[p].key, node.start)
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
            | VisitedKind::ImportDeferName(_) => TypeId::ERROR,
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
            ExprKind::String(_) if hir.text.get(hir[e].pos as usize) == Some(&b'#') => {
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

    /// The names of the properties of object literals that name nothing (`getDeclarationName`): `#x` with no class around it, `1n`.
    /// The declaration has a symbol all the same.
    fn types_at_unbound_property_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let hir = self.hir(file);
        for index in 0..hir.props.len() {
            let p = PropId(index as u32);
            let prop = hir[p];
            // A name the parser missed is not written.
            if matches!(prop.kind, PropKind::Spread)
                || !matches!(prop.key, PropKey::None)
                || !matches!(hir.text.get(prop.pos as usize), Some(b'#' | b'0'..=b'9'))
            {
                continue;
            }
            let ty = self.type_of_literal_prop(file, p);
            results.push(TypeAtLocation {
                start: prop.pos,
                end: self.end_of_token_at(file, prop.pos),
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_property(file, p),
                ),
                kind: "property-name",
            });
        }
    }

    /// The names of the members that have no line yet, because they are no property of their container: `[e]` whose `e` is not written
    /// as a name (`isLateBindableAST`), whatever its type; `#x` where there is no class to declare it; `1n` (`getDeclarationName`).
    fn types_at_unbound_member_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let hir = self.hir(file);
        let mut written: Vec<u32> = results
            .iter()
            .filter(|found| found.kind == "member-name")
            .map(|found| found.start)
            .collect();
        written.sort_unstable();
        for index in 0..hir.members.len() {
            let m = MemberId(index as u32);
            let member = hir[m];
            if !matches!(
                member.kind,
                MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
            ) || matches!(member.key, PropKey::Name(_))
            {
                continue;
            }
            let start = super::errors_x_properties_jsx::start_of_member_name(hir, m);
            // A name the parser missed is not written.
            let is_written = matches!(
                hir.text.get(start as usize),
                Some(b'[' | b'#' | b'0'..=b'9')
            );
            if !is_written || written.binary_search(&start).is_ok() {
                continue;
            }
            let ty = self.type_of_member_declaration(file, m);
            results.push(TypeAtLocation {
                start,
                end: self.end_of_name_at(file, start),
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_member(file, m),
                ),
                kind: "member-name",
            });
        }
    }

    /// The `PropertyName` of an import or export specifier is visited only if it is an identifier.
    fn remove_string_property_names_of_specifiers(
        &self,
        file: FileId,
        results: &mut Vec<TypeAtLocation>,
    ) {
        let hir = self.hir(file);
        let imported = hir
            .import_specs
            .iter()
            .map(|spec| (spec.imported_pos, spec.pos));
        let exported = hir
            .export_specs
            .iter()
            .map(|spec| (spec.local_pos, spec.pos));
        let mut unwritten: Vec<u32> = imported
            .chain(exported)
            .filter(|&(property_name, name)| {
                property_name != name
                    && matches!(hir.text.get(property_name as usize), Some(b'"' | b'\''))
            })
            .map(|(property_name, _)| property_name)
            .collect();
        unwritten.sort_unstable();
        results.retain(|found| {
            found.kind != "declaration-name" || unwritten.binary_search(&found.start).is_err()
        });
    }

    /// `parseJsxAttributeName`: the name of an attribute goes on over `-` and `:name`. The two identifiers of `a:b` get a line too,
    /// with the error type.
    fn extend_jsx_attribute_names(&self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let hir = self.hir(file);
        let mut identifiers = Vec::new();
        // The lines of property names, by where they start.
        let mut names: Vec<(u32, usize)> = results
            .iter()
            .enumerate()
            .filter(|(_, found)| found.kind == "property-name")
            .map(|(index, found)| (found.start, index))
            .collect();
        names.sort_unstable();
        for jsx in hir.jsx.iter() {
            for p in jsx.attrs.iter() {
                if matches!(hir[p].kind, PropKind::Spread) {
                    continue;
                }
                let start = hir[p].pos;
                let end = self.end_of_jsx_attr_name(file, p);
                let first = names.partition_point(|name| name.0 < start);
                for name in names[first..].iter().take_while(|name| name.0 == start) {
                    results[name.1].end = end;
                }
                let written = hir
                    .text
                    .get(start as usize..end as usize)
                    .unwrap_or_default();
                let Some(colon) = written.iter().position(|&b| b == b':') else {
                    continue;
                };
                let colon = start + colon as u32;
                identifiers.push((start, self.end_of_token_before(file, colon)));
                identifiers.push((self.skip_trivia_from(file, colon + 1), end));
            }
        }
        for (start, end) in identifiers {
            results.push(TypeAtLocation {
                start,
                end,
                type_text: "error".to_owned(),
                kind: "error-type",
            });
        }
    }

    /// The name in `export as namespace N`.
    fn types_at_namespace_export_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for index in 0..hir.stmts.len() {
            let stmt = StmtId(index as u32);
            if !matches!(hir[stmt].kind, StmtKind::ExportAsNamespace(_)) {
                continue;
            }
            let decl = Decl::UmdGlobal(stmt);
            let Some(start) = self.declaration_name_start(file, decl) else {
                continue;
            };
            // `bindNamespaceExportDeclaration` gives it a symbol only at the top of a module.
            let symbol = bound
                .umd_globals
                .iter()
                .map(|global| global.1)
                .find(|id| bound.symbols[id.idx()].decls.contains(&decl));
            let ty = match symbol {
                Some(id) => {
                    let sym = self.files().sym(file, id);
                    self.type_of_symbol(sym)
                }
                None => TypeId::ANY,
            };
            let end = self.end_of_token_at(file, start);
            if ty.is_any() {
                results.push(TypeAtLocation {
                    start,
                    end,
                    type_text: "error".to_owned(),
                    kind: "error-type",
                });
                continue;
            }
            results.push(TypeAtLocation {
                start,
                end,
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_declaration(file, decl),
                ),
                kind: "declaration-name",
            });
        }
    }

    /// The `[e]` of a member whose `e` has no type that names a property: the type its declaration gives it.
    fn types_at_dynamic_member_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let hir = self.hir(file);
        for index in 0..hir.members.len() {
            let m = MemberId(index as u32);
            let member = hir[m];
            if !matches!(
                member.kind,
                MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
            ) || !matches!(member.key, PropKey::Computed(_))
                || self.member_name(file, member.key).is_some()
            {
                continue;
            }
            let start = super::errors_x_properties_jsx::start_of_member_name(hir, m);
            if hir.text.get(start as usize) != Some(&b'[') {
                continue;
            }
            let ty = self.type_of_member_declaration(file, m);
            results.push(TypeAtLocation {
                start,
                end: self.end_of_bracket_at(file, start),
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_member(file, m),
                ),
                kind: "member-name",
            });
        }
    }

    /// The template of a tagged template, of which the lowered tree keeps the substitutions. `checkTemplateExpression` does not
    /// evaluate it: with substitutions it is a `string`. Without, it is a string literal.
    fn types_at_tagged_template_literals(
        &mut self,
        file: FileId,
        results: &mut Vec<TypeAtLocation>,
    ) {
        let hir = self.hir(file);
        for index in 0..hir.exprs.len() {
            let e = ExprId(index as u32);
            let ExprKind::TaggedTemplate(c) = hir[e].kind else {
                continue;
            };
            let Some(start) = self.start_of_tagged_template_literal(file, c) else {
                continue;
            };
            let end = self.end_inside_parentheses(file, e);
            let type_text = if hir[c].args.is_empty() {
                // The cooked text is not kept. It is the raw text if nothing in that is escaped.
                let Some(raw) = hir
                    .text
                    .get(start as usize + 1..(end as usize).saturating_sub(1))
                else {
                    continue;
                };
                if hir.text.get(end as usize - 1) != Some(&b'`')
                    || raw.iter().any(|b| matches!(b, b'\\' | b'\r'))
                {
                    continue;
                }
                let ty = self.string_literal(self.files().atoms.intern(raw), false);
                self.type_to_string_for_baseline(ty)
            } else {
                "string".to_owned()
            };
            results.push(TypeAtLocation {
                start,
                end,
                type_text,
                kind: "expression",
            });
        }
    }

    /// `GetMeaningFromDeclaration`: the name of a namespace has a value meaning only if the declaration is
    /// `ModuleInstanceStateInstantiated`.
    fn remove_uninstantiated_namespace_names(
        &self,
        file: FileId,
        results: &mut Vec<TypeAtLocation>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut unwritten = Vec::new();
        for index in 0..hir.modules.len() {
            let is_instantiated = bound.module_instantiated[index]
                && !self.is_const_enum_only_module(file, ModuleId(index as u32));
            if matches!(hir.modules[index].name, ModuleName::Ident(_)) && !is_instantiated {
                unwritten.push(hir.modules[index].name_pos);
            }
        }
        unwritten.sort_unstable();
        results.retain(|found| {
            found.kind != "declaration-name" || unwritten.binary_search(&found.start).is_err()
        });
    }

    /// `IsAmbientModule`: the names of `declare module "m"` and `declare global`.
    fn types_at_ambient_module_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for index in 0..hir.modules.len() {
            let module = hir.modules[index];
            let symbol = bound.module_symbol[index];
            if matches!(module.name, ModuleName::Ident(_)) || symbol.is_none() {
                continue;
            }
            let sym = self.files().sym(file, symbol);
            let ty = self.type_of_symbol(sym);
            results.push(TypeAtLocation {
                start: module.name_pos,
                end: self.end_of_token_at(file, module.name_pos),
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_declaration(file, Decl::Module(ModuleId(index as u32))),
                ),
                kind: "declaration-name",
            });
        }
    }

    /// The names of function expressions and class expressions. `getTypeOfSymbol` of either is the type of the expression.
    fn types_at_expression_declaration_names(
        &mut self,
        file: FileId,
        results: &mut Vec<TypeAtLocation>,
    ) {
        let hir = self.hir(file);
        for index in 0..hir.exprs.len() {
            let e = ExprId(index as u32);
            let (name, start, decl) = match hir[e].kind {
                ExprKind::Fn(f) if hir[f].kind == FnKind::Expr => {
                    (hir[f].name, hir[f].name_pos, Decl::Fn(f))
                }
                ExprKind::Class(c) => (hir[c].name, hir[c].name_pos, Decl::Class(c)),
                _ => continue,
            };
            if name.is_none() || name == known::empty {
                continue;
            }
            let ty = self.type_of_expr(file, e);
            results.push(TypeAtLocation {
                start,
                end: self.end_of_token_at(file, start),
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_declaration(file, decl),
                ),
                kind: "declaration-name",
            });
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
            || hir.parens.iter().any(|paren| paren.0 == e)
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

    /// `getTypeOfNode` of the names of the declarations that have a symbol of their own.
    fn types_at_declaration_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `declareSymbolEx`: `Symbol::decls` also lists the declarations the symbol refused. Each has a symbol of its own, made later.
        let mut symbol_of_declaration: FxHashMap<Decl, usize> = FxHashMap::default();
        for (index, symbol) in bound.symbols.iter().enumerate() {
            for &decl in symbol.decls.as_slice() {
                symbol_of_declaration.insert(decl, index);
            }
        }
        for index in 0..bound.symbols.len() {
            let sym = self.files().sym(file, SymbolId(index as u32));
            for &decl in bound.symbols[index].decls.as_slice() {
                if symbol_of_declaration.get(&decl) != Some(&index) {
                    continue;
                }
                // `IsTypeDeclaration`: the declared type. Otherwise the type of the symbol.
                let (name, is_type_declaration) = match decl {
                    Decl::Class(c) => (
                        hir[c].name,
                        matches!(bound.class_owner[c.idx()], crate::bind::ClassOwner::Stmt(_)),
                    ),
                    Decl::Enum(e) => (hir[e].name, true),
                    Decl::Alias(a) => (hir[a].name, true),
                    Decl::Fn(f) => (hir[f].name, false),
                    Decl::EnumMember(m) => (hir[m].name, false),
                    // `import type a from`, `import type { a }`, `export type { a }`: the `type` of the clause, not of the specifier.
                    Decl::ImportDefault(import) => {
                        (bound.symbols[index].name, hir[import].type_only)
                    }
                    Decl::ImportSpec(spec) => (
                        bound.symbols[index].name,
                        hir.imports.iter().any(|import| {
                            import.type_only && import.named.range().contains(&spec.idx())
                        }),
                    ),
                    Decl::ExportSpec(spec) => (
                        bound.symbols[index].name,
                        hir.exports.iter().any(|export| {
                            export.type_only && export.items.range().contains(&spec.idx())
                        }),
                    ),
                    Decl::Module(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportEquals(_)
                    | Decl::ExportStarAs(_) => (bound.symbols[index].name, false),
                    // Variables and parameters are patterns. The name of an interface or a type parameter has no value meaning.
                    _ => continue,
                };
                // A method is written with the other members.
                if let Decl::Fn(f) = decl
                    && !matches!(
                        bound.fns[f.idx()].owner,
                        FnOwner::Stmt(_) | FnOwner::Expr(_)
                    )
                {
                    continue;
                }
                if name == Atom::NONE {
                    continue;
                }
                let Some(start) = self.declaration_name_start(file, decl) else {
                    continue;
                };
                // `IsTypeDeclarationName`: a name that is a string literal is not one.
                let is_identifier = !matches!(hir.text.get(start as usize), Some(b'"' | b'\''));
                let ty = match decl {
                    _ if !is_type_declaration || !is_identifier => self.type_of_symbol(sym),
                    Decl::ImportDefault(_) | Decl::ImportSpec(_) | Decl::ExportSpec(_) => {
                        self.get_declared_type_of_alias(sym)
                    }
                    _ => self.declared_type(sym),
                };
                // `import { a as b }`, `export { a as b }`: `a` is written too (`IsDeclarationNameOrImportPropertyName`), with the
                // type of what the specifier stands for (`getImmediateAliasedSymbol`).
                let property_name = match decl {
                    Decl::ImportSpec(spec) if hir[spec].imported_pos != hir[spec].pos => {
                        Some((hir[spec].imported_pos, self.type_of_symbol(sym)))
                    }
                    Decl::ExportSpec(spec) if hir[spec].local_pos != hir[spec].pos => {
                        Some((hir[spec].local_pos, self.type_of_symbol(sym)))
                    }
                    _ => None,
                };
                for (start, ty) in [Some((start, ty)), property_name].into_iter().flatten() {
                    self.enclosing_module_specifier_mode =
                        self.mode_of_module_specifier_of_declaration(file, decl);
                    let type_text = self.type_to_string_for_baseline_at(
                        ty,
                        file,
                        self.enclosing_scope_of_declaration(file, decl),
                    );
                    self.enclosing_module_specifier_mode = None;
                    results.push(TypeAtLocation {
                        start,
                        end: self.end_of_name_at(file, start),
                        type_text,
                        kind: "declaration-name",
                    });
                }
            }
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

    /// The names of the members of classes, interfaces and type literals.
    fn types_at_member_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for index in 0..hir.members.len() {
            let m = MemberId(index as u32);
            let member = hir[m];
            if !matches!(
                member.kind,
                MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
            ) {
                continue;
            }
            let Some(name) = self.member_name(file, member.key) else {
                continue;
            };
            let container = match bound.member_owner[index] {
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
                MemberOwner::None => continue,
            };
            let Some((prop, _)) = self.prop_of(container, name) else {
                continue;
            };
            let has_own_symbol = match &prop.source {
                PropSource::Members(declarations) => {
                    self.is_excluded_by_earlier_members(declarations, (file, m))
                }
                // `bindClassLikeDeclaration` declares the property `prototype` before the members.
                _ => {
                    name == known::prototype
                        && member.kind == MemberKind::Method
                        && member.flags.contains(Flags::STATIC)
                        && matches!(bound.member_owner[index], MemberOwner::Class(_))
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
            let ty = self.type_of_prop(&prop, MapperId::IDENTITY);
            let start = super::errors_x_properties_jsx::start_of_member_name(hir, m);
            results.push(TypeAtLocation {
                start,
                end: self.end_of_name_at(file, start),
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_member(file, m),
                ),
                kind: "member-name",
            });
        }
    }

    /// `declareSymbolEx`: whether the flags of the earlier ones of `declarations`, the members of one name in one symbol table,
    /// exclude `member`. It is the only declaration of a symbol that is not in the table then.
    fn is_excluded_by_earlier_members(
        &self,
        declarations: &[(FileId, MemberId)],
        member: (FileId, MemberId),
    ) -> bool {
        const PROPERTY: u8 = 1;
        const METHOD: u8 = 2;
        const GET_ACCESSOR: u8 = 4;
        const SET_ACCESSOR: u8 = 8;
        let mut flags = 0;
        for &(file, m) in declarations {
            let declaration = &self.hir(file)[m];
            // `SymbolFlags..Excludes`
            let (includes, excludes) = match declaration.kind {
                MemberKind::Method => (METHOD, PROPERTY | GET_ACCESSOR | SET_ACCESSOR),
                MemberKind::Getter => (GET_ACCESSOR, GET_ACCESSOR | METHOD),
                MemberKind::Setter => (SET_ACCESSOR, SET_ACCESSOR | METHOD),
                _ if declaration.flags.contains(Flags::ACCESSOR) => (
                    GET_ACCESSOR | SET_ACCESSOR,
                    GET_ACCESSOR | SET_ACCESSOR | METHOD,
                ),
                _ => (PROPERTY, METHOD),
            };
            let is_excluded = flags & excludes != 0;
            if (file, m) == member {
                return is_excluded;
            }
            if !is_excluded {
                flags |= includes;
            }
        }
        false
    }

    /// The names of the properties of object literals and of JSX attributes.
    fn types_at_property_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let hir = self.hir(file);
        for index in 0..hir.props.len() {
            let p = PropId(index as u32);
            let prop = hir[p];
            if matches!(prop.kind, PropKind::Spread) || matches!(prop.key, PropKey::None) {
                continue;
            }
            // `with { type: "json" }`: the name of an import attribute is no declaration name, and `getTypeOfNode` ends in the error
            // type. It is written `any` if the test has errors (`hadErrorBaseline`), which whoever has the report knows.
            if hir.import_attributes.iter().any(|&(_, attributes)| {
                matches!(hir[attributes].kind, ExprKind::Object(props) if props.range().contains(&index))
            }) {
                // `typeWriterWalker.visitNode`: a string literal there is not visited.
                if !matches!(hir.text.get(prop.pos as usize), Some(b'"' | b'\'')) {
                    results.push(TypeAtLocation {
                        start: prop.pos,
                        end: self.end_of_name_at(file, prop.pos),
                        type_text: "error".to_owned(),
                        kind: "error-type",
                    });
                }
                continue;
            }
            let ty = self.type_of_literal_member_symbol(file, p);
            results.push(TypeAtLocation {
                start: prop.pos,
                end: self.end_of_name_at(file, prop.pos),
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_property(file, p),
                ),
                kind: "property-name",
            });
        }
    }
}

impl Checker<'_> {
    /// The names of intrinsic JSX elements, which are strings in the syntax tree.
    fn types_at_intrinsic_jsx_tag_names(
        &mut self,
        file: FileId,
        results: &mut Vec<TypeAtLocation>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for index in 0..hir.exprs.len() {
            let element = ExprId(index as u32);
            let ExprKind::Jsx(jsx) = hir[element].kind else {
                continue;
            };
            let Some(&scope) = bound.expr_scope.get(&element) else {
                continue;
            };
            for tag in [hir[jsx].tag, hir[jsx].close_tag] {
                if tag.is_some()
                    && let ExprKind::String(name) = hir[tag].kind
                {
                    self.type_at_intrinsic_jsx_tag_name(file, scope, name, hir[tag].pos, results);
                }
            }
            // `</name>` that repeats the opening name is not kept in the syntax tree.
            if hir[jsx].close_tag.is_none()
                && hir[jsx].close_pos != u32::MAX
                && hir[jsx].tag.is_some()
                && let ExprKind::String(name) = hir[hir[jsx].tag].kind
                && let Some(start) = start_of_jsx_closing_tag_name(
                    &hir.text,
                    hir[jsx].close_pos,
                    self.atom_text(name).as_bytes(),
                )
            {
                self.type_at_intrinsic_jsx_tag_name(file, scope, name, start, results);
            }
        }
    }

    /// `IsJsxTagName`: the identifier is an expression, and `checkIdentifier` resolves it as a value from where the element is.
    /// The two identifiers of a `JsxNamespacedName` are no expressions: `getTypeOfNode` has the error type for them.
    fn type_at_intrinsic_jsx_tag_name(
        &mut self,
        file: FileId,
        scope: crate::bind::ScopeId,
        name: Atom,
        start: u32,
        results: &mut Vec<TypeAtLocation>,
    ) {
        let text = &self.hir(file).text;
        let end = super::errors_jsx::jsx_name_end(text, start);
        if self.atom_text(name).contains(':') {
            let is_identifier_part = |c: &&u8| {
                c.is_ascii_alphanumeric() || matches!(**c, b'_' | b'$' | b'-') || **c >= 0x80
            };
            let written = text.get(start as usize..end as usize).unwrap_or_default();
            let namespace_end =
                start + written.iter().take_while(is_identifier_part).count() as u32;
            let name_start =
                end - written.iter().rev().take_while(is_identifier_part).count() as u32;
            let type_text = self.type_to_string_for_baseline(TypeId::ERROR);
            results.push(TypeAtLocation {
                start,
                end: namespace_end,
                type_text: type_text.clone(),
                kind: "expression",
            });
            if name_start > namespace_end {
                results.push(TypeAtLocation {
                    start: name_start,
                    end,
                    type_text,
                    kind: "expression",
                });
            }
            return;
        }
        let ty = match self
            .files()
            .resolve_name(file, scope, name, SymFlags::VALUE)
        {
            Some(sym) => {
                let ty = self.type_of_symbol(sym);
                self.regular(ty)
            }
            None => TypeId::ANY,
        };
        results.push(TypeAtLocation {
            start,
            end,
            type_text: self.type_to_string_for_baseline_at(ty, file, scope),
            kind: "expression",
        });
    }
}

/// Where `name` starts in `</name>`, whose `<` is at `close_pos`. `None` if something else is written there.
fn start_of_jsx_closing_tag_name(text: &[u8], close_pos: u32, name: &[u8]) -> Option<u32> {
    let skip_white_space = |mut at: usize| {
        while text.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        at
    };
    let slash = skip_white_space(close_pos as usize + 1);
    if name.is_empty() || text.get(slash) != Some(&b'/') {
        return None;
    }
    let start = skip_white_space(slash + 1);
    // `a : b` is the name `a:b`.
    let end = super::errors_jsx::jsx_name_end(text, start as u32) as usize;
    let written = text.get(start..end)?;
    written
        .iter()
        .filter(|c| !c.is_ascii_whitespace())
        .eq(name)
        .then_some(start as u32)
}

impl Checker<'_> {
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

impl Checker<'_> {
    /// The exceptions of `writeTypeOrSymbol`, for the names of declarations: those whose error type is written `any` in a test without
    /// errors too.
    fn write_any_for_exempt_error_types(&self, file: FileId, results: &mut [TypeAtLocation]) {
        if !results
            .iter()
            .any(|found| found.type_text == ERROR_TYPE_TEXT)
        {
            return;
        }
        let hir = self.hir(file);
        let mut names = Vec::new();
        // `isImportStatementName`, `isExportStatementName`
        for import in &hir.imports {
            if import.default.is_some() {
                names.push(import.default_pos);
            }
            for spec in import.named.iter() {
                names.extend([hir[spec].pos, hir[spec].imported_pos]);
            }
        }
        names.extend(hir.import_equals.iter().map(|import| import.name_pos));
        for export in &hir.exports {
            for spec in export.items.iter() {
                names.extend([hir[spec].pos, hir[spec].local_pos]);
            }
        }
        // `IsGlobalScopeAugmentation(node.Parent)`
        for module in hir.modules.iter() {
            if matches!(module.name, ModuleName::Global) {
                names.push(module.name_pos);
            }
        }
        for found in results.iter_mut() {
            if found.type_text == ERROR_TYPE_TEXT
                && found.kind == "declaration-name"
                && names.contains(&found.start)
            {
                found.type_text = "any".to_owned();
            }
        }
    }
}
