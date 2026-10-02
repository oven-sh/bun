//! The type at every expression and declaration name of a file: what TypeScript's test harness writes into `.types` baselines
//! (`typeWriterWalker`, `GetTypeAtLocation`).

use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, SymbolId};

/// `typeWriterResult`
pub struct TypeAtLocation {
    pub start: u32,
    pub end: u32,
    pub type_text: String,
    /// What kind of node it is, for telling apart where a difference comes from.
    pub kind: &'static str,
}

impl Checker<'_> {
    /// `typeWriterWalker.getTypes`, in no particular order. The file must have been checked, as in the harness.
    pub fn types_at_locations(&mut self, file: FileId) -> Vec<TypeAtLocation> {
        let hir = self.hir(file);
        let mut results = Vec::with_capacity(hir.exprs.len() * 2);
        let mut text_of_expr: Vec<Option<String>> = vec![None; hir.exprs.len()];
        // `IsExpressionWithTypeArgumentsInClassExtendsClause`: the harness writes the base type there, not the type of the expression.
        let mut extended: Vec<ExprId> = hir.classes.iter().map(|class| class.extends).collect();
        // A shorthand property is one node, which is written as a name. A method or an accessor is a declaration: the function
        // expression that stands for it is no node.
        extended.extend(
            hir.props
                .iter()
                .filter(|prop| {
                    matches!(
                        prop.kind,
                        PropKind::Shorthand
                            | PropKind::Method
                            | PropKind::Getter
                            | PropKind::Setter
                    )
                })
                .map(|prop| prop.value),
        );
        // Written by `types_at_intrinsic_jsx_tag_names`.
        extended.extend(
            hir.jsx
                .iter()
                .flat_map(|jsx| [jsx.tag, jsx.close_tag])
                .filter(|&tag| tag.is_some() && matches!(hir[tag].kind, ExprKind::String(_))),
        );
        let (literal_types, literal_prop_types) = self.literal_types_in_resolved_context(file);
        for index in 0..hir.exprs.len() {
            let e = ExprId(index as u32);
            let expr = hir[e];
            // `checkSpreadExpression` gives a spread element the type of what is iterated over, which `type_of_expr` does not.
            if matches!(expr.kind, ExprKind::Missing | ExprKind::Spread(_)) || extended.contains(&e)
            {
                continue;
            }
            let ty = match self.type_of_export_assignment_name(file, e) {
                Some(ty) => ty,
                None => {
                    // `getRegularTypeOfExpression`
                    let ty = match literal_types.get(&e) {
                        Some(&ty) => ty,
                        None => self.type_of_expr(file, e),
                    };
                    self.regular(ty)
                }
            };
            let scope = self.enclosing_scope_of_expr(file, e);
            let type_text = self.type_to_string_for_baseline_at(ty, file, scope);
            // `isRightSideOfQualifiedNameOrPropertyAccess`: the name has the type of the whole access.
            // A private name is no identifier, and an expression only on the left of `in`.
            if let ExprKind::Dot { name, name_pos, .. } = expr.kind
                && hir.text.get(name_pos as usize) != Some(&b'#')
            {
                results.push(TypeAtLocation {
                    start: name_pos,
                    end: name_pos + self.atom_text(name).len() as u32,
                    type_text: type_text.clone(),
                    kind: "access-name",
                });
            }
            // `IsPartOfTypeNode` takes the keyword `null` for a type wherever it is written. Parentheses around it get a line.
            if matches!(expr.kind, ExprKind::Null) {
                text_of_expr[index] = Some(type_text);
                continue;
            }
            // `writeTypeOrSymbol`: an assertion whose type node is reparsed from a `@type` or `@satisfies` tag is not written.
            let is_reparsed_cast = match expr.kind {
                ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => {
                    ty.is_some() && hir.is_in_jsdoc(hir[ty].pos)
                }
                ExprKind::AsConst(_) => hir.is_js,
                _ => false,
            };
            if !is_reparsed_cast {
                results.push(TypeAtLocation {
                    start: self.start_inside_parentheses(file, e),
                    end: self.end_inside_parentheses(file, e),
                    type_text: type_text.clone(),
                    kind: "expression",
                });
            }
            text_of_expr[index] = Some(type_text);
        }
        for &(e, outermost) in &hir.parens {
            if let Some(type_text) = &text_of_expr[e.idx()] {
                for open in self.parenthesis_starts(file, e, outermost) {
                    results.push(TypeAtLocation {
                        start: open,
                        end: self.end_of_expr_from(file, e, open),
                        type_text: type_text.clone(),
                        kind: "parenthesized",
                    });
                }
            }
        }
        for index in 0..hir.pats.len() {
            let pat = PatId(index as u32);
            let PatKind::Ident(name) = hir[pat].kind else {
                continue;
            };
            // `getTypeOfSymbol`
            let (declared_in, first) = self.value_declaration_of_variable_name(file, pat);
            let ty = self.type_of_pat(declared_in, first);
            // `bindVariableDeclarationOrBindingElement`: `const x = require(..)` declares an alias. `getTypeOfNode` of its name is
            // the type of what the alias stands for.
            let required = self.bound(file).pat_symbol[pat.idx()];
            let ty = if required.is_some()
                && self.bound(file).symbols[required.idx()]
                    .flags
                    .contains(SymFlags::ALIAS)
            {
                let alias = self.files().sym(file, required);
                self.type_of_symbol(alias)
            } else {
                ty
            };
            results.push(TypeAtLocation {
                start: hir[pat].pos,
                end: hir[pat].pos + self.atom_text(name).len() as u32,
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_pat(file, pat),
                ),
                kind: "variable",
            });
        }
        self.types_at_intrinsic_jsx_tag_names(file, &mut results);
        self.types_at_declaration_names(file, &mut results);
        self.types_at_ambient_module_names(file, &mut results);
        self.types_at_expression_declaration_names(file, &mut results);
        self.types_at_labels_and_binding_property_names(file, &mut results);
        self.types_at_qualified_type_names(file, &mut results);
        self.types_at_class_extends(file, &mut results);
        self.types_at_member_names(file, &mut results);
        self.types_at_property_names(file, &mut results);
        // `getTypeOfSymbol` of the property first checks its initializer when the writer asks, under the same contextual type.
        for (&p, &ty) in &literal_prop_types {
            let ty = self.widened(ty);
            let type_text = self.type_to_string_for_baseline(ty);
            for result in results
                .iter_mut()
                .filter(|result| result.kind == "property-name" && result.start == hir[p].pos)
            {
                result.type_text.clone_from(&type_text);
            }
        }
        // `forEachASTNode` leaves out what is reparsed from a JSDoc comment, and a comment is no child of a node.
        results.retain(|found| !hir.is_in_jsdoc(found.start));
        self.remove_uninstantiated_namespace_names(file, &mut results);
        results
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
        results
            .retain(|found| found.kind != "declaration-name" || !unwritten.contains(&found.start));
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
                type_text: self.type_to_string_for_baseline(ty),
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
            let (name, start) = match hir[e].kind {
                ExprKind::Fn(f) if hir[f].kind == FnKind::Expr => (hir[f].name, hir[f].name_pos),
                ExprKind::Class(c) => (hir[c].name, hir[c].name_pos),
                _ => continue,
            };
            if name.is_none() || name == known::empty {
                continue;
            }
            let ty = self.type_of_expr(file, e);
            results.push(TypeAtLocation {
                start,
                end: self.end_of_token_at(file, start),
                type_text: self.type_to_string_for_baseline(ty),
                kind: "declaration-name",
            });
        }
    }

    /// Identifiers nothing in `getTypeOfNode` applies to, which have the error type: labels, and `a` in the binding pattern `{ a: b }`.
    fn types_at_labels_and_binding_property_names(
        &self,
        file: FileId,
        results: &mut Vec<TypeAtLocation>,
    ) {
        let hir = self.hir(file);
        let mut starts = Vec::new();
        for stmt in &hir.stmts {
            match stmt.kind {
                StmtKind::Labeled { .. } => starts.push(stmt.pos),
                StmtKind::Break(label) | StmtKind::Continue(label) if label.is_some() => {
                    let keyword_end = self.end_of_token_at(file, stmt.pos);
                    starts.push(self.skip_trivia_from(file, keyword_end));
                }
                _ => {}
            }
        }
        for prop in &hir.pat_props {
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
                starts.push(prop.pos);
            }
        }
        for start in starts {
            results.push(TypeAtLocation {
                start,
                end: self.end_of_token_at(file, start),
                type_text: "any".to_owned(),
                kind: "no-type",
            });
        }
    }

    /// The range of each name of the entity name `A.B.C` that is written at `pos`, up to a name that is missing.
    fn entity_name_ranges(&self, file: FileId, pos: u32, names: IdList<Atom>) -> Vec<(u32, u32)> {
        let hir = self.hir(file);
        let mut ranges = Vec::with_capacity(names.len());
        let mut start = pos;
        for name in hir.ids(names) {
            if name == known::empty {
                break;
            }
            let end = self.end_of_token_at(file, start);
            ranges.push((start, end));
            let dot = self.skip_trivia_from(file, end);
            if hir.text.get(dot as usize) != Some(&b'.') {
                break;
            }
            start = self.skip_trivia_from(file, dot + 1);
        }
        ranges
    }

    /// `isPartOfTypeNodeInParent`: of `A.B.C` in a type only `C` and the whole are part of a type node. Nothing in `getTypeOfNode`
    /// applies to `A` and `B`, which have the error type.
    fn types_at_qualified_type_names(&self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let hir = self.hir(file);
        // `IsNameOfHeritageClauseTypeReference`: there `A.B` gets a line as well.
        let mut heritage: Vec<TypeNodeId> = Vec::new();
        for class in &hir.classes {
            heritage.extend(hir.ids(class.implements));
        }
        for interface in &hir.interfaces {
            heritage.extend(hir.ids(interface.extends));
        }
        for index in 0..hir.types.len() {
            let node = TypeNodeId(index as u32);
            let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
                continue;
            };
            if name.len() < 2 || hir.is_in_jsdoc(hir[node].pos) {
                continue;
            }
            let ranges = self.entity_name_ranges(file, hir[node].pos, name);
            let is_in_heritage_clause = heritage.contains(&node);
            for (position, &(start, end)) in ranges.iter().enumerate().take(name.len() - 1) {
                results.push(TypeAtLocation {
                    start,
                    end,
                    type_text: "any".to_owned(),
                    kind: "qualifier",
                });
                if position > 0 && is_in_heritage_clause {
                    results.push(TypeAtLocation {
                        start: ranges[0].0,
                        end,
                        type_text: "any".to_owned(),
                        kind: "qualifier",
                    });
                }
            }
        }
    }

    /// Where each of the parentheses around `e` opens, the outermost first. `hir.parens` keeps `outermost`.
    fn parenthesis_starts(&self, file: FileId, e: ExprId, outermost: u32) -> Vec<u32> {
        let hir = self.hir(file);
        let inside = self.start_inside_parentheses(file, e);
        let mut starts = Vec::new();
        let mut at = outermost;
        while at < inside && hir.text.get(at as usize) == Some(&b'(') {
            starts.push(at);
            at = self.skip_trivia_from(file, at + 1);
        }
        starts
    }

    /// `IsExpressionWithTypeArgumentsInClassExtendsClause`: the harness writes the base type at the expression after `extends`, and
    /// the type of the expression if the base type is `any` or there is none.
    fn types_at_class_extends(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for index in 0..hir.classes.len() {
            let e = hir.classes[index].extends;
            if e.is_none() || matches!(hir[e].kind, ExprKind::Missing | ExprKind::Null) {
                continue;
            }
            let ty = self.type_of_expr(file, e);
            let ty = self.regular(ty);
            let ty = self
                .type_of_export_assignment_identifier(file, e)
                .unwrap_or(ty);
            let expression_text = self.type_to_string_for_baseline(ty);
            let class = self.files().sym(file, bound.class_symbol[index]);
            let base_text = match self.base_types(class).first() {
                Some(&base) if base != TypeId::ANY => self.type_to_string_for_baseline(base),
                _ => expression_text.clone(),
            };
            // The node right under the clause comes first.
            let mut nodes = Vec::new();
            if let Ok(found) = hir.parens.binary_search_by_key(&e.0, |p| p.0.0) {
                for open in self.parenthesis_starts(file, e, hir.parens[found].1) {
                    nodes.push((open, self.end_of_expr_from(file, e, open), "parenthesized"));
                }
            }
            nodes.push((
                self.start_inside_parentheses(file, e),
                self.end_inside_parentheses(file, e),
                "expression",
            ));
            for (depth, (start, end, kind)) in nodes.into_iter().enumerate() {
                let type_text = if depth == 0 {
                    base_text.clone()
                } else {
                    expression_text.clone()
                };
                results.push(TypeAtLocation {
                    start,
                    end,
                    type_text,
                    kind,
                });
            }
            if let ExprKind::Dot { name_pos, .. } = hir[e].kind
                && hir.text.get(name_pos as usize) != Some(&b'#')
            {
                results.push(TypeAtLocation {
                    start: name_pos,
                    end: self.end_of_token_at(file, name_pos),
                    type_text: expression_text,
                    kind: "access-name",
                });
            }
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
        let Some(symbol) = symbol else {
            return Some(TypeId::ANY);
        };
        Some(
            if self.type_flags_of_symbol(symbol).intersects(SymFlags::TYPE) {
                self.declared_type(symbol)
            } else {
                self.type_of_symbol(symbol)
            },
        )
    }

    /// `getTypeOfNode` of the identifier `e` in `export default e` or `export = e`, which is no expression node
    /// (`IsInExpressionContext`): `isInRightSideOfImportOrExportAssignment`. `None` for anything else, and for a name that does not resolve.
    fn type_of_export_assignment_identifier(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(name) = hir[e].kind else {
            return None;
        };
        let crate::bind::Parent::Stmt(stmt) = bound.expr_parent[e.idx()] else {
            return None;
        };
        if stmt.is_none()
            || !matches!(hir[stmt].kind, StmtKind::ExportDefault(x) | StmtKind::ExportAssign(x) if x == e)
            || hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok()
        {
            return None;
        }
        // `getSymbolOfNameOrPropertyAccessExpression`
        let files = self.files();
        let all_meanings = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
        let sym = files.resolve_name(file, *bound.expr_scope.get(&e)?, name, all_meanings)?;
        // `tryGetDeclaredTypeOfSymbol`, `getDeclaredTypeOfAlias`
        let target = if files.flags(sym).intersects(SymFlags::TYPE) {
            Some(sym)
        } else {
            files.resolve_alias(sym)
        };
        match target {
            Some(target) if files.flags(target).intersects(SymFlags::TYPE) => {
                Some(self.declared_type(target))
            }
            _ => Some(self.type_of_symbol(sym)),
        }
    }

    /// `getTypeOfNode` of the names of the declarations that have a symbol of their own.
    fn types_at_declaration_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for index in 0..bound.symbols.len() {
            let sym = self.files().sym(file, SymbolId(index as u32));
            for &decl in bound.symbols[index].decls.as_slice() {
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
                    let type_text = self.type_to_string_for_baseline_at(
                        ty,
                        file,
                        self.enclosing_scope_of_declaration(file, decl),
                    );
                    results.push(TypeAtLocation {
                        start,
                        end: end_of_name(&hir.text, start),
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
            // `getTypeOfSymbol` of the symbol the member declares, which is not instantiated: `this` is the type parameter.
            let ty = self.type_of_prop(&prop, MapperId::IDENTITY);
            let start = super::errors_x_properties_jsx::start_of_member_name(hir, m);
            results.push(TypeAtLocation {
                start,
                end: end_of_name(&hir.text, start),
                type_text: self.type_to_string_for_baseline_at(
                    ty,
                    file,
                    self.enclosing_scope_of_member(file, m),
                ),
                kind: "member-name",
            });
        }
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
            // `getWidenedTypeForVariableLikeDeclaration`
            let ty = self.type_of_literal_prop(file, p);
            let ty = self.widened(ty);
            results.push(TypeAtLocation {
                start: prop.pos,
                end: end_of_name(&hir.text, prop.pos),
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
            let type_text = self.type_to_string_for_baseline(TypeId::ANY);
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
            type_text: self.type_to_string_for_baseline(ty),
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
    text.get(start..)?.starts_with(name).then_some(start as u32)
}

/// The end of the property name, identifier or string that starts at `start`.
fn end_of_name(text: &[u8], start: u32) -> u32 {
    let mut at = start as usize;
    match text.get(at) {
        Some(&quote @ (b'"' | b'\'')) => {
            at += 1;
            while at < text.len() && text[at] != quote {
                at += if text[at] == b'\\' { 2 } else { 1 };
            }
            at + 1
        }
        Some(b'[') => {
            let mut depth = 0usize;
            while at < text.len() {
                match text[at] {
                    b'[' | b'(' | b'{' => depth += 1,
                    b']' | b')' | b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
                at += 1;
            }
            at + 1
        }
        _ => {
            while at < text.len()
                && (text[at].is_ascii_alphanumeric()
                    || matches!(text[at], b'_' | b'$' | b'#' | b'.' if text[at] != b'.' || text[start as usize].is_ascii_digit())
                    || text[at] >= 0x80)
            {
                at += 1;
            }
            at
        }
    }
    .min(text.len()) as u32
}
