//! Property names, names in namespaces, and module exports:
//! 2464, 2694 2713 2724 2749, 1117 1118 1119 2300, 2528 2309 2661, 1361 1362.
//!
//! Follows `checkComputedPropertyName`, `resolveQualifiedName`,
//! `checkGrammarObjectLiteralExpression`, `checkExternalModuleExports`, `checkExportSpecifier`,
//! `getTypeOnlyAliasDeclarationEx` and the end of `onSuccessfullyResolvedSymbol` of TypeScript
//! 7.0.2's checker.go and grammarchecks.go, `IsValidTypeOnlyAliasUseSite` of its ast/utilities.go,
//! and the errors `declareSymbolEx` of its binder.go reports for default exports.

use super::errors::is_close;
use super::*;
use crate::bind::{PatParent, ScopeId};

impl Checker<'_> {
    pub(super) fn check_names_and_exports(&mut self, file: FileId) {
        self.check_computed_names(file);
        self.check_exports(file);
        self.check_type_only_names_used_as_values(file);
    }

    /// `checkComputedPropertyName`
    fn check_computed_names(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut keys: Vec<(ExprId, u32)> = Vec::new();
        keys.extend(hir.props.iter().filter_map(|p| match p.key {
            PropKey::Computed(e) => Some((e, p.pos)),
            _ => None,
        }));
        keys.extend(hir.members.iter().filter_map(|m| match m.key {
            PropKey::Computed(e) => Some((e, m.name_pos)),
            _ => None,
        }));
        for p in &hir.pat_props {
            if let PropKey::Computed(e) = p.key
                && !self.is_binding_element_key_unchecked(file, p)
            {
                keys.push((e, p.pos));
            }
        }
        for (e, start) in keys {
            if bound.is_unchecked(e.idx()) {
                continue;
            }
            let ty = self.type_of_expr(file, e);
            if self.is_any(ty) {
                continue;
            }
            // `TypeFlagsNullable`: every kind of `undefined` and `null`, widening or declared.
            let is_nullable = ty.is_null() || ty.is_undefined();
            let expected = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
            if is_nullable || !self.is_assignable(ty, expected) {
                self.error_at((file, start, self.end_of_name_at(file, start)), 2464, &[]);
            }
        }
    }

    /// Whether `checkComputedPropertyName` never sees the computed key of the binding element `prop`.
    /// `checkVariableLikeDeclaration` returns before the key of `{ [key]: name }` in a parameter of a function without a body.
    /// `getBindingElementTypeFromParentType` still checks the key when it computes the type of `name` or of a `...rest` sibling,
    /// unless the parent type is `any`.
    fn is_binding_element_key_unchecked(&mut self, file: FileId, prop: &PatProp) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Prop(pattern, _) = bound.pat_parent[prop.value.idx()] else {
            return false;
        };
        let is_renamed_in_signature = matches!(hir[prop.value].kind, PatKind::Ident(_))
            && matches!(root_declaration(bound, pattern), PatParent::Param(p) if matches!(hir[bound.param_fn[p.idx()]].body, FnBody::None));
        if !is_renamed_in_signature {
            return false;
        }
        let symbol = bound.pat_symbol[prop.value.idx()];
        let is_referenced = symbol.is_some() && bound.expr_symbol.contains(&symbol);
        let has_rest_sibling = matches!(hir[pattern].kind, PatKind::Object(props) if props.iter().any(|p| hir[p].is_rest));
        if !is_referenced && !has_rest_sibling {
            return true;
        }
        let parent_type = self.type_for_binding_element_parent(file, prop.value, pattern);
        self.is_any(parent_type)
    }

    /// `resolveQualifiedName`: each name after the first must be an export of the symbol the
    /// preceding names resolve to.
    pub(super) fn check_qualified_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: Span<NameId>,
        meaning: SymFlags,
    ) {
        let (files, hir) = (self.files(), self.hir(file));
        let first = hir[names.at(0)].text;
        let Some(mut namespace) = files.resolve_name(file, scope, first, SymFlags::NAMESPACE)
        else {
            return;
        };
        for (i, right) in names.iter().enumerate().skip(1) {
            let name = hir[right].text;
            // `NodeIsMissing(right)`: the parser has reported the missing name.
            if name == known::empty {
                return;
            }
            // The loop at the end of `resolveEntityName`: an alias that is merged with a namespace is not resolved further.
            let Some(resolved) = files.resolve_alias_as(namespace, SymFlags::NAMESPACE) else {
                return;
            };
            // What has whatever is asked of it.
            if files.symbol(resolved).exports.is_none() && resolved != files.global_this_symbol
                || !files.flags(resolved).intersects(SymFlags::NAMESPACE)
            {
                return;
            }
            let is_last = i + 1 == names.len();
            let expected = if is_last {
                meaning
            } else {
                SymFlags::NAMESPACE
            };
            let text = self.atoms().bytes(name);
            let exported = files.namespace_member(resolved, name);
            // `getSymbol`: an alias is matched by the meaning of its target.
            let found = self.get_symbol(exported, expected).or_else(|| {
                // The exports of the alias target come second. `resolveAlias` stops at the first symbol with a meaning of its own.
                if !files.flags(resolved).contains(SymFlags::ALIAS) {
                    return None;
                }
                let target = files.canonical(files.alias_target(resolved)?);
                let target = files.resolve_alias_as(
                    target,
                    SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
                )?;
                files
                    .namespace_member(target, name)
                    .filter(|&m| files.means(m, expected))
            });
            if let Some(member) = found {
                namespace = member;
                continue;
            }
            // `getSuggestedSymbolForNonexistentModule`: an enum member, `export default 1` and
            // `export =` are never suggested.
            let exports = if files.flags(resolved).intersects(SymFlags::MODULE) {
                files.exports_of_module(resolved).to_vec()
            } else {
                files.exports(resolved)
            };
            let is_candidate = |&(other, sym): &(Atom, Sym)| {
                other != known::export_equals
                    && files.flags(sym).intersects(SymFlags::MODULE_MEMBER)
                    && is_close(text, self.atoms().bytes(other))
            };
            let is_misspelt = exports.iter().any(is_candidate);
            if is_misspelt {
                {
                    let candidates = exports.iter().filter(|&candidate| is_candidate(candidate));
                    let get_name = |candidate: &(Atom, Sym)| self.atoms().bytes(candidate.0);
                    let suggested =
                        get_spelling_suggestion(text, candidates, get_name, |a, b| a.1.cmp(&b.1));
                    let arg0 = fully_qualified_name(self, resolved);
                    let arg1 = suggested.map_or(Arg::Bytes(b""), |s| Arg::Sym(s.1));
                    let args = [Arg::Bytes(&arg0), Arg::Atom(name), arg1];
                    self.error(file, right, 2724, &args);
                }
                return;
            }
            // After `implements`, and after the `extends` of an interface, the names form a
            // property access, not a `QualifiedName`.
            if hir.kind(hir.node(names)) == Kind::QualifiedName {
                if expected.intersects(SymFlags::TYPE) {
                    let texts: smallvec::SmallVec<[Atom; 8]> = hir.texts(names).collect();
                    match self.is_qualified_name_a_value(file, scope, &texts) {
                        Some(true) => {
                            // `getContainingQualifiedNameNode`: all of the names. `entityNameToString`
                            let written: Vec<&[u8]> =
                                texts.iter().map(|&n| self.atoms().bytes(n)).collect();
                            self.error(file, names, 2749, &[Arg::Bytes(&written.join(&b'.'))]);
                            return;
                        }
                        Some(false) => {}
                        None => return,
                    }
                }
                // A type where a namespace is expected: the name after it is the one that cannot be
                // accessed.
                if !is_last
                    && let Some(exported) = exported.filter(|&m| files.means(m, SymFlags::TYPE))
                {
                    let after = names.at(i + 1);
                    let args = [Arg::Sym(exported), Arg::Atom(hir[after].text)];
                    self.error(file, after, 2713, &args);
                    return;
                }
            }
            let arg0 = fully_qualified_name(self, resolved);
            self.error(file, right, 2694, &[Arg::Bytes(&arg0), Arg::Atom(name)]);
            return;
        }
    }

    /// `tryGetQualifiedNameAsValue`: whether the whole of `a.b.c`, read as an expression, resolves.
    /// `None`: undetermined.
    fn is_qualified_name_a_value(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
    ) -> Option<bool> {
        let Some(first) = self
            .files()
            .resolve_name(file, scope, names[0], SymFlags::VALUE)
        else {
            return Some(false);
        };
        let mut ty = self.type_of_symbol(first);
        for &name in &names[1..] {
            let Some((prop, mapper)) = self.get_property_of_type(ty, name) else {
                return Some(false);
            };
            ty = self.type_of_prop(prop, mapper);
        }
        Some(true)
    }

    /// `isGlobalSourceFile(GetDeclarationContainer(symbol.Declarations[0]))`
    pub(super) fn is_first_declared_in_global_source_file(&self, sym: Sym) -> bool {
        let files = self.files();
        files
            .decls_of(sym)
            .first()
            .is_some_and(|&(file, declaration)| {
                let hir = files.hir(file);
                !files.module(file).is_module()
                    && hir.kind(hir.get_declaration_container(hir.node(declaration)))
                        == Kind::SourceFile
            })
    }

    fn check_exports(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // And `export =` all by itself.
        if self.files().module(file).is_module() {
            self.check_export_equals_alone(file, self.files().file_symbol(file));
            return;
        }
        // At the top level of a module, `declare module "m"` augments `m` and is exempt:
        // `isTopLevelInExternalModuleAugmentation`.
        for s in hir.ids(hir.body) {
            if let StmtKind::Module(m) = hir[s].kind
                && matches!(hir[m].name, ModuleName::String(_))
                && bound.module_symbol[m.idx()].is_some()
            {
                self.check_export_equals_alone(
                    file,
                    self.files().sym(file, bound.module_symbol[m.idx()]),
                );
            }
        }
    }

    /// The position where `declareSymbolEx` reports a conflict for the statement `s`, an `export
    /// default e` or `export = e`: the start of `GetNameOfDeclaration(node)`, or of the node if it
    /// has no name.
    pub(super) fn export_assignment_name_start(&self, file: FileId, s: StmtId) -> u32 {
        let hir = self.hir(file);
        // `GetNonAssignedNameOfDeclaration`: an Identifier is the name of the declaration. Any other expression leaves it without one.
        match hir[s].kind {
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) if !is_parenthesized(hir, e) => {
                match hir[e].kind {
                    ExprKind::Ident(_) => hir[e].pos,
                    // `createMissingIdentifier`. `GetErrorRangeForNode` skips no trivia before a missing node.
                    ExprKind::Missing => self.end_of_expr(file, e),
                    _ => hir[s].start,
                }
            }
            _ => hir[s].start,
        }
    }

    /// `checkExternalModuleExports`: `export =` must be the only value export, and if types are
    /// exported next to it, it must not name a namespace that has types.
    fn check_export_equals_alone(&mut self, file: FileId, module: Sym) {
        let files = self.files();
        let Some(equals) = files.export(module, known::export_equals) else {
            return;
        };
        // For a module with several declarations it may be in another file.
        let declaration = files
            .declaration_of_alias_symbol(equals)
            .or_else(|| files.value_declaration(equals))
            .filter(|declaration| declaration.0 == file);
        let Some((start, end)) =
            declaration.and_then(|it| self.error_range_of_declaration(file, it.1))
        else {
            return;
        };
        let others = |of: Sym| {
            files
                .exports(of)
                .into_iter()
                .filter(|e| e.0 != known::export_equals)
        };
        // `hasExportedMembersOfKind`. An unresolved alias matches any meaning: `getSymbolFlags`.
        let exports_values = others(module).any(|(_, sym)| {
            files
                .resolve_alias_if_needed(sym)
                .is_none_or(|s| files.flags(s).intersects(SymFlags::VALUE))
        });
        // `hasShadowedNamespace`. `bindCommonJSTypeExports`: the types and namespaces declared next to `export = name` are members of it.
        let types = SymFlags::TYPE | SymFlags::NAMESPACE;
        let shadows_a_namespace = || {
            files.flags(equals).contains(SymFlags::ALIAS)
                && others(module).any(|(_, sym)| files.flags(sym).intersects(types))
                && files.resolve_alias(equals).is_some_and(|target| {
                    files.flags(target).intersects(SymFlags::NAMESPACE)
                        && others(target).any(|(_, sym)| files.means(sym, types))
                })
        };
        if exports_values || shadows_a_namespace() {
            self.error_at((file, start, end), 2309, &[]);
        }
    }

    /// `addTypeOnlyDeclarationRelatedInfo` for `getTypeOnlyAliasDeclarationEx(sym,
    /// SymbolFlagsValue)`. `name`: the name of the alias at the error location.
    pub(super) fn type_only_declaration_related(&self, sym: Sym, name: Vec<u8>) -> Vec<Reported> {
        let type_only = self
            .files()
            .type_only_alias_declaration_ex(sym, SymFlags::VALUE);
        type_only.map_or_else(Vec::new, |type_only| {
            self.aliases_type_only_related(type_only, type_only.is_export(), name)
        })
    }

    /// `onSuccessfullyResolvedSymbol`: 1361, 1362.
    fn check_type_only_names_used_as_values(&mut self, file: FileId) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        if hir.kind == FileKind::Declaration {
            return;
        }
        // Indexed by symbol, allocated lazily when the first name is checked: each symbol is
        // examined once, however often it is used. 0: not computed yet. 1: nothing is reported.
        let mut inspected: Vec<u8> = Vec::new();
        for &(e, _) in &bound.alias_idents {
            let local = bound.expr_symbol[e.idx()];
            if local.is_none() || bound.is_unchecked(e.idx()) {
                continue;
            }
            let symbol = &bound.symbols[local.idx()];
            if !symbol.flags.contains(SymFlags::ALIAS) || symbol.flags.intersects(SymFlags::VALUE) {
                continue;
            }
            if inspected.is_empty() {
                inspected.resize(bound.symbols.len(), 0);
            }
            if inspected[local.idx()] == 1 {
                continue;
            }
            let sym = files.sym(file, local);
            // `getSymbol`: it resolves as a value. An unresolved alias matches the value meaning
            // like any other meaning.
            let type_only = files
                .type_only_alias_declaration_ex(sym, SymFlags::VALUE)
                .filter(|_| files.symbol_flags(sym).intersects(SymFlags::VALUE));
            inspected[local.idx()] = 1 + u8::from(type_only.is_some());
            let Some(type_only) = type_only else {
                continue;
            };
            if is_valid_type_only_alias_use_site(hir, hir.node(e)) {
                continue;
            }
            let is_export = type_only.is_export();
            let at = self.place_of_token(file, hir[e].pos);
            self.aliases_error_about_type_only(
                at,
                if is_export { 1362 } else { 1361 },
                &[Arg::Atom(symbol.name)],
                Some((type_only, is_export)),
                symbol.name,
            );
        }
    }
}

/// `IsValidTypeOnlyAliasUseSite` for a name or an access expression that is an `ExprId`. Also true
/// for the syntax `checkVariableLikeDeclaration` does not check: anything inside a parameter of a
/// signature without a body.
pub(super) fn is_valid_type_only_alias_use_site(hir: &hir::File, use_site: Node) -> bool {
    // `isPartOfPossiblyValidTypeOrAbstractComputedPropertyName`
    let mut name = use_site;
    while matches!(
        hir.kind(name),
        Kind::Identifier | Kind::PropertyAccessExpression
    ) {
        name = hir.parent(name);
    }
    let named = hir.parent(name);
    let parameter = hir.find_ancestor_kind(use_site, Kind::Parameter);
    let function = hir.fns.get(hir.function_of(hir.parent(parameter)).idx());
    hir.is_ambient(use_site)
        || hir.is_in_type_query(use_site)
        || hir.kind(name) == Kind::ComputedPropertyName
            && (hir.flags(named).contains(Flags::ABSTRACT)
                || matches!(
                    hir.kind(hir.parent(named)),
                    Kind::InterfaceDeclaration | Kind::TypeLiteral
                ))
        // `IsInExpressionContext`: an exported bare identifier is not an expression.
        || hir.kind(use_site) == Kind::Identifier
            && hir.kind(hir.parent(use_site)) == Kind::ExportAssignment
        || function.is_some_and(|function| matches!(function.body, FnBody::None))
}

/// `getFullyQualifiedName`
pub(super) fn fully_qualified_name(c: &mut Checker<'_>, sym: Sym) -> Vec<u8> {
    let name = c.symbol_to_string(sym);
    match c.files().symbol_parent(sym) {
        Some(parent) => cat!(fully_qualified_name(c, parent), b".", name),
        None => name,
    }
}

/// `getFullyQualifiedName` for an `AliasTarget`. A synthesized property (of a union, an intersection, a mapped type, a tuple) has no `Parent`.
pub(super) fn fully_qualified_name_of(c: &mut Checker<'_>, symbol: AliasTarget) -> Vec<u8> {
    let (object, name) = match symbol {
        AliasTarget::Symbol(symbol) => return fully_qualified_name(c, symbol),
        AliasTarget::Property(object, name, _) => (object, name),
        AliasTarget::Unknown => return b"unknown".to_vec(),
    };
    let Some((mut prop, _)) = c.get_property_of_type(object, name) else {
        return c.atoms().bytes(name).to_vec();
    };
    // `getSpreadSymbol` keeps the `Parent` of the original property.
    while let PropSource::Copy(_, of, true) = &prop.source {
        prop = &of[0];
    }
    let mut qualified = match prop.source {
        PropSource::Symbol(symbol) => return fully_qualified_name(c, symbol),
        PropSource::Literal(file, property) => {
            let owner = c.bound(file).prop_owner[property.idx()];
            let mut parent = c.name_of_object_literal(file, owner);
            parent.push(b'.');
            parent
        }
        _ => Vec::new(),
    };
    c.write_prop(&mut qualified, prop);
    qualified
}

/// `GetRootDeclaration`: the variable or the parameter whose binding pattern contains `pat`.
pub(super) fn root_declaration(bound: &Bound, pat: PatId) -> PatParent {
    bound.pat_parent[root_pattern(bound, pat).idx()]
}

/// Its name: the outermost binding pattern that contains `pat`.
pub(super) fn root_pattern(bound: &Bound, mut pat: PatId) -> PatId {
    while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) = bound.pat_parent[pat.idx()] {
        pat = outer;
    }
    pat
}
