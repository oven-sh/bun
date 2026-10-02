//! Names of properties, names in namespaces, and what a module exports:
//! 2464, 2694 2713 2724 2749, 1117 1118 1119 2300, 2528 2309 2661, 1361 1362.
//!
//! Follows `checkComputedPropertyName`, `resolveQualifiedName`, `checkGrammarObjectLiteralExpression`, `checkExternalModuleExports`,
//! `checkExportSpecifier`, `getTypeOnlyAliasDeclarationEx` and the end of `onSuccessfullyResolvedSymbol` of TypeScript 7.0.2's
//! checker.go and grammarchecks.go, `IsValidTypeOnlyAliasUseSite` of its ast/utilities.go, and what `declareSymbolEx` of its binder.go
//! says of default exports.

use super::errors::{Diagnostic, is_close};
use super::*;
use crate::bind::{Decl, MemberOwner, Parent, PatParent, ScopeId};
use crate::util::number_repeated;
use smallvec::SmallVec;

impl Checker<'_> {
    pub(super) fn check_names_and_exports(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        self.check_computed_names(file, out);
        self.check_object_literal_names(file, out);
        self.check_exports(file, out);
        self.check_ambient_export_assignments(file, out);
        self.check_type_only_names_used_as_values(file, out);
    }

    /// `checkComputedPropertyName`
    fn check_computed_names(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
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
            if !self.is_known(ty) || self.is_any(ty) {
                continue;
            }
            // `TypeFlagsNullable`: every kind of `undefined` and `null`, widening or declared.
            let is_nullable = ty.is_null() || ty.is_undefined();
            let wanted = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
            if is_nullable || !self.is_assignable(ty, wanted) {
                out.push(Diagnostic { start, code: 2464 });
                self.note(start, self.end_of_name_at(file, start), 2464, Vec::new());
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
        !self.is_known(parent_type) || self.is_any(parent_type)
    }

    /// `resolveQualifiedName`: each name after the first has to be exported by what the names before it come to.
    /// `start`: where the first is written.
    pub(super) fn check_qualified_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        start: u32,
        meaning: SymFlags,
        out: &mut Vec<Diagnostic>,
    ) {
        let (files, hir) = (self.files(), self.hir(file));
        let Some(mut namespace) = files.resolve_name(file, scope, names[0], SymFlags::NAMESPACE)
        else {
            return;
        };
        let mut at = next_name(&hir.text, start + files.atoms.bytes(names[0]).len() as u32);
        for (i, &name) in names.iter().enumerate().skip(1) {
            // `NodeIsMissing(right)`: the parser has reported the missing name.
            if name == known::empty {
                return;
            }
            // The loop at the end of `resolveEntityName`: an alias that is merged with a namespace is not resolved further.
            let Some(resolved) = files.resolve_alias_as(namespace, SymFlags::NAMESPACE) else {
                return;
            };
            // What has whatever is asked of it.
            if files.symbol(resolved).exports.is_none()
                || !files.flags(resolved).intersects(SymFlags::NAMESPACE)
            {
                return;
            }
            let is_last = i + 1 == names.len();
            let wanted = if is_last {
                meaning
            } else {
                SymFlags::NAMESPACE
            };
            let text = files.atoms.bytes(name);
            let next = next_name(&hir.text, at + text.len() as u32);
            let exported = files.namespace_member(resolved, name);
            // `getSymbol`: an alias goes by what it stands for.
            let found = self.get_symbol(exported, wanted).or_else(|| {
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
                    .filter(|&m| files.means(m, wanted))
            });
            if let Some(member) = found {
                namespace = member;
                at = next;
                continue;
            }
            // `getSuggestedSymbolForNonexistentModule`: neither a member of an enum nor `export default 1` nor `export =` is what was meant.
            let exports = if files.flags(resolved).intersects(SymFlags::MODULE) {
                files.exports_of_module(resolved).to_vec()
            } else {
                files.exports(resolved)
            };
            let is_candidate = |&(other, sym): &(Atom, Sym)| {
                other != known::export_equals
                    && files.flags(sym).intersects(SymFlags::MODULE_MEMBER)
                    && is_close(text, files.atoms.bytes(other))
            };
            let is_misspelt = exports.iter().any(is_candidate);
            if is_misspelt {
                out.push(Diagnostic {
                    start: at,
                    code: 2724,
                });
                self.explain(at, 2724, |c| {
                    let candidates = exports.iter().filter(|&candidate| is_candidate(candidate));
                    let get_name = |candidate: &(Atom, Sym)| files.atoms.bytes(candidate.0);
                    let suggested =
                        get_spelling_suggestion(text, candidates, get_name, |a, b| a.1.cmp(&b.1));
                    vec![
                        fully_qualified_name(c, resolved),
                        c.atom_text(name),
                        suggested.map_or_else(String::new, |s| c.symbol_to_string(s.1)),
                    ]
                });
                return;
            }
            // After `implements`, and after the `extends` of an interface, the names are a property access and no `QualifiedName`.
            let is_heritage = hir
                .classes
                .iter()
                .any(|c| hir.ids(c.implements).any(|t| hir[t].pos == start))
                || hir
                    .interfaces
                    .iter()
                    .any(|x| hir.ids(x.extends).any(|t| hir[t].pos == start));
            if !is_heritage {
                if wanted.intersects(SymFlags::TYPE) {
                    match self.is_qualified_name_a_value(file, scope, names) {
                        Some(true) => {
                            out.push(Diagnostic { start, code: 2749 });
                            // `getContainingQualifiedNameNode`: all of the names.
                            let mut end = at + text.len() as u32;
                            for &later in &names[i + 1..] {
                                end = next_name(&hir.text, end)
                                    + files.atoms.bytes(later).len() as u32;
                            }
                            self.explain_to(start, end, 2749, |c| {
                                let written: Vec<String> =
                                    names.iter().map(|&n| c.atom_text(n)).collect();
                                vec![written.join(".")]
                            });
                            return;
                        }
                        Some(false) => {}
                        None => return,
                    }
                }
                // A type where a namespace goes: it is the name after it that cannot be got at.
                if !is_last && exported.is_some_and(|m| files.means(m, SymFlags::TYPE)) {
                    // A missing name starts right after the dot.
                    let dot = skip_trivia(&hir.text, at as usize + text.len());
                    let is_missing =
                        names[i + 1] == known::empty && hir.text.get(dot) == Some(&b'.');
                    let right = if is_missing { dot as u32 + 1 } else { next };
                    out.push(Diagnostic {
                        start: right,
                        code: 2713,
                    });
                    let right_name = names[i + 1];
                    self.explain(right, 2713, |c| {
                        vec![
                            exported.map_or_else(String::new, |m| c.symbol_to_string(m)),
                            c.atom_text(right_name),
                        ]
                    });
                    return;
                }
            }
            out.push(Diagnostic {
                start: at,
                code: 2694,
            });
            self.explain(at, 2694, |c| {
                vec![fully_qualified_name(c, resolved), c.atom_text(name)]
            });
            return;
        }
    }

    /// `tryGetQualifiedNameAsValue`: whether all of `a.b.c`, read as an expression, is something. `None`: that cannot be told.
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
            // `getPropertyOfType`: of the apparent type, with what every function and every object has. `any` has no properties, and
            // what an index signature covers is none.
            let reduced = self.reduced(ty);
            let apparent = self.apparent_type(reduced);
            if !self.is_known(ty) || !self.is_known(apparent) {
                return None;
            }
            ty = if self.is_union(apparent) {
                let Some(found) = self.type_of_property(apparent, name) else {
                    return Some(false);
                };
                found
            } else {
                let Some(members) = self.members(apparent) else {
                    return Some(false);
                };
                let Some((prop, mapper)) = self.property_of_type(&members, name) else {
                    return Some(false);
                };
                self.type_of_prop(&prop, mapper)
            };
        }
        Some(true)
    }

    /// `checkGrammarObjectLiteralExpression`, as far as one name written twice goes.
    fn check_object_literal_names(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        const GET: u8 = 1;
        const SET: u8 = 2;
        const PROPERTY: u8 = 4;
        const METHOD: u8 = 8;
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.has_errors {
            return;
        }
        let index = self.exprs_by_kind(file);
        for &literal in index.of(ExprTag::Object) {
            let ExprKind::Object(props) = hir[literal].kind else {
                continue;
            };
            if props.len() < 2
                || bound.is_unchecked(literal.idx())
                || self.is_assignment_target(file, literal)
            {
                continue;
            }
            // Of names that are all written out and all different there is nothing to say.
            let mut written: SmallVec<[Atom; 16]> = SmallVec::new();
            let mut is_all_written = true;
            for p in props.iter() {
                let prop = &hir[p];
                if prop.kind == PropKind::Spread {
                    continue;
                }
                match prop.key {
                    PropKey::Name(name) | PropKey::Private(name) => written.push(name),
                    PropKey::Computed(_) => {
                        is_all_written = false;
                        break;
                    }
                    PropKey::None => {}
                }
            }
            if is_all_written && number_repeated(&written).is_empty() {
                continue;
            }
            let container = bound.expr_symbol[literal.idx()];
            if !is_all_written && container.is_some() {
                let container = self.files().sym(file, container);
                self.report_conflicts_of_late_bound_members(file, container, false, out);
            }
            let mut seen: SmallVec<[(Atom, u8); 8]> = SmallVec::new();
            for p in props.iter() {
                let prop = &hir[p];
                let current = match prop.kind {
                    PropKind::Init | PropKind::Shorthand => PROPERTY,
                    PropKind::Method => METHOD,
                    PropKind::Getter => GET,
                    PropKind::Setter => SET,
                    PropKind::Spread => continue,
                };
                let Some(name) = self.member_name(file, prop.key) else {
                    continue;
                };
                let Some(entry) = seen.iter_mut().find(|s| s.0 == name) else {
                    seen.push((name, current));
                    continue;
                };
                let existing = entry.1;
                let code = if current & METHOD != 0 && existing & METHOD != 0 {
                    2300
                } else if current & PROPERTY != 0 && existing & PROPERTY != 0 {
                    1117
                } else if current & (GET | SET) != 0 && existing & (GET | SET) != 0 {
                    if existing != GET | SET && current != existing {
                        entry.1 |= current;
                        continue;
                    }
                    1118
                } else {
                    1119
                };
                out.push(Diagnostic {
                    start: prop.pos,
                    code,
                });
                // `[1]` and `["a"]` are kept as plain names.
                if matches!(prop.key, PropKey::Computed(_)) || code != 2300 {
                    let end = self.end_of_prop_name(file, p);
                    let args = if code == 2300 {
                        vec![self.source_text(file, prop.pos, end)]
                    } else {
                        Vec::new()
                    };
                    self.note(prop.pos, end, code, args);
                }
                if code == 1118 || code == 1119 {
                    break;
                }
            }
        }
    }

    /// `IsGlobalSourceFile(GetDeclarationContainer(symbol.Declarations[0]))`
    fn is_first_declared_in_global_source_file(&self, sym: Sym) -> bool {
        let files = self.files();
        let Some(part) = files
            .parts(sym)
            .iter()
            .copied()
            .find(|&part| !files.symbol(part).decls.is_empty())
        else {
            return false;
        };
        let (hir, bound) = (files.hir(part.file), files.bound(part.file));
        let symbol = files.symbol(part);
        // The locals of a script: what is declared at its top, not in a `global` block, a namespace or an ambient module.
        if files.module(part.file).is_module()
            || bound.lookup(bound.scopes[0].locals, symbol.name) != Some(part.id)
        {
            return false;
        }
        // A `var` is among them wherever it is written.
        let Decl::Var(pat) = symbol.decls[0] else {
            return true;
        };
        let PatParent::Var(declaration) = root_declaration(bound, pat) else {
            return false;
        };
        let statement = bound.var_stmt[declaration.idx()];
        if statement.is_none() {
            return false;
        }
        // The declarations in the head of a loop are in what the loop is in.
        let container = match bound.stmt_parent[statement.idx()] {
            Parent::Stmt(around)
                if matches!(
                    hir[around].kind,
                    StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. }
                ) =>
            {
                bound.stmt_parent[around.idx()]
            }
            container => container,
        };
        container == Parent::File
    }

    fn check_exports(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What is exported by name, without saying from where, has to be the module's own.
        for (x, export) in hir.exports.iter().enumerate() {
            if export.spec.is_some() || bound.export_scope[x].is_none() {
                continue;
            }
            for s in export.items.iter() {
                let name = hir[s].local;
                let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
                let is_global = self
                    .files()
                    .resolve_name(file, bound.export_scope[x], name, all)
                    .is_some_and(|found| {
                        found == self.files().undefined_symbol
                            || found == self.files().global_this_symbol
                            || self.is_first_declared_in_global_source_file(found)
                    });
                let text = self.files().atoms.bytes(name);
                let is_primitive = matches!(
                    text,
                    b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown"
                );
                if is_global
                    || is_primitive
                        && self
                            .files()
                            .resolve_name(file, bound.export_scope[x], name, all)
                            .is_none()
                {
                    out.push(Diagnostic {
                        start: hir[s].local_pos,
                        code: 2661,
                    });
                }
            }
        }
        // And `export =` all by itself.
        if self.files().module(file).is_module() {
            self.check_export_equals_alone(file, self.files().file_symbol(file), out);
            return;
        }
        // At the top of a module `declare module "m"` adds to `m`, and is let off: `isTopLevelInExternalModuleAugmentation`.
        for s in hir.ids(hir.body) {
            if let StmtKind::Module(m) = hir[s].kind
                && matches!(hir[m].name, ModuleName::String(_))
                && bound.module_symbol[m.idx()].is_some()
            {
                self.check_export_equals_alone(
                    file,
                    self.files().sym(file, bound.module_symbol[m.idx()]),
                    out,
                );
            }
        }
    }

    /// `checkExportAssignment`: 2714, what `export =` or `export default` names in an ambient context is an entity name.
    fn check_ambient_export_assignments(&self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_declaration_file = hir.kind == FileKind::Declaration;
        for (i, s) in hir.stmts.iter().enumerate() {
            let (StmtKind::ExportAssign(e) | StmtKind::ExportDefault(e)) = s.kind else {
                continue;
            };
            // In a block or in a namespace it is out of place, and no more is said of it.
            let is_ambient = match bound.stmt_parent[i] {
                Parent::File => is_declaration_file,
                Parent::Module(m) if !matches!(hir[m].name, ModuleName::Ident(_)) => {
                    is_declaration_file || hir[m].flags.contains(Flags::AMBIENT)
                }
                _ => continue,
            };
            if is_ambient && e.is_some() && !is_entity_name_expression(self.hir(file), e) {
                let start = self.start_of(file, e);
                out.push(Diagnostic { start, code: 2714 });
                self.note(start, self.end_of_expr(file, e), 2714, Vec::new());
            }
        }
    }

    /// Where `declareSymbolEx` reports a conflict of the statement `s`, an `export default e` or `export = e`: the start of
    /// `GetNameOfDeclaration(node)`, or of the node if it has no name.
    pub(super) fn export_assignment_name_start(&self, file: FileId, s: StmtId) -> u32 {
        let hir = self.hir(file);
        let (e, token) = match hir[s].kind {
            StmtKind::ExportDefault(e) => (e, &b"default"[..]),
            StmtKind::ExportAssign(e) => (e, &b"="[..]),
            _ => return hir[s].pos,
        };
        // `GetNonAssignedNameOfDeclaration`: an Identifier is the name of the declaration. Any other expression leaves it without one.
        match hir[e].kind {
            _ if is_parenthesized(self.hir(file), e) => hir[s].pos,
            ExprKind::Ident(_) => hir[e].pos,
            // `createMissingIdentifier`: an empty Identifier at the end of the previous token. `GetErrorRangeForNode` skips no trivia
            // before a missing node.
            ExprKind::Missing => {
                token_end_after_export(&hir.text, hir[s].pos, token).unwrap_or(hir[s].pos)
            }
            _ => hir[s].pos,
        }
    }

    /// `checkExternalModuleExports`: `export =` stands alone among values, and with types next to it it names no namespace that has types.
    fn check_export_equals_alone(&self, file: FileId, module: Sym, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        // The first there is, which for a module declared in several places may be written in another file.
        let Some(equals) = files
            .export(module, known::export_equals)
            .filter(|equals| equals.file == file)
        else {
            return;
        };
        // `module.exports = e` is one too.
        let written = files.symbol(equals).decls.iter().find_map(|d| match *d {
            Decl::ExportExpr(statement) => Some((self.hir(file)[statement].pos, *d)),
            Decl::ModuleExports(e) => Some((self.start_of(file, e), *d)),
            _ => None,
        });
        let Some((start, declaration)) = written else {
            return;
        };
        let others = |of: Sym| {
            files
                .exports(of)
                .into_iter()
                .filter(|e| e.0 != known::export_equals)
        };
        // `hasExportedMembersOfKind`. An alias that leads nowhere may be anything: `getSymbolFlags`.
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
            out.push(Diagnostic { start, code: 2309 });
            let end = match declaration {
                Decl::ExportExpr(statement) => self.end_of_stmt(file, statement),
                Decl::ModuleExports(e) => self.end_of_expr(file, e),
                _ => 0,
            };
            self.note(start, end, 2309, Vec::new());
        }
    }

    /// `addTypeOnlyDeclarationRelatedInfo`, of `getTypeOnlyAliasDeclarationEx(sym, SymbolFlagsValue)`. `name`: what the alias goes by
    /// where the error is.
    pub(super) fn type_only_declaration_related(
        &self,
        sym: Sym,
        name: String,
    ) -> Vec<super::explain::Related> {
        let type_only = self
            .files()
            .type_only_alias_declaration_ex(sym, SymFlags::VALUE);
        type_only.map_or_else(Vec::new, |type_only| {
            self.xa_type_only_related(type_only, type_only.is_export(), name)
        })
    }

    /// The end of `onSuccessfullyResolvedSymbol`: 1361, 1362.
    fn check_type_only_names_used_as_values(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.kind == FileKind::Declaration
            // In JavaScript `const a = require("m")` declares an alias too.
            || hir.imports.is_empty() && hir.import_equals.is_empty() && !hir.is_js
        {
            return;
        }
        // What is said of each name where it is used as a value. It is looked into once, however often it is used.
        // By symbol, once there is a name to ask about. 0: nothing is said.
        const NOT_LOOKED_INTO: u32 = u32::MAX;
        let mut codes: Vec<u32> = Vec::new();
        for &(e, _) in &bound.alias_idents {
            let i = e.idx();
            let local = bound.expr_symbol[i];
            if local.is_none() || bound.is_unchecked(i) {
                continue;
            }
            let flags = bound.symbols[local.idx()].flags;
            if !flags.contains(SymFlags::ALIAS)
                || flags.intersects(SymFlags::VALUE)
                || bound.is_in_type_query(e)
            {
                continue;
            }
            if codes.is_empty() {
                codes.resize(bound.symbols.len(), NOT_LOOKED_INTO);
            }
            if codes[local.idx()] == NOT_LOOKED_INTO {
                let sym = self.files().sym(file, local);
                // `getSymbol`: an alias that leads nowhere goes for a value as for anything else.
                let flags = self.files().symbol_flags(sym);
                let is_value = if flags == SymFlags::all() {
                    self.is_alias_in_error(sym)
                } else {
                    flags.intersects(SymFlags::VALUE)
                };
                let type_only = self
                    .files()
                    .type_only_alias_declaration_ex(sym, SymFlags::VALUE);
                codes[local.idx()] = match is_value.then(|| type_only.map(|t| t.is_export())) {
                    Some(Some(true)) => 1362,
                    Some(Some(false)) => 1361,
                    _ => 0,
                };
            }
            let code = codes[local.idx()];
            if code == 0 {
                continue;
            }
            // `IsValidTypeOnlyAliasUseSite`. `top`: all of `a.b.c`, as far as there are no parentheses in it.
            let mut top = e;
            let root = loop {
                match bound.expr_parent[top.idx()] {
                    Parent::Expr(p)
                        if !is_parenthesized(hir, top)
                            && matches!(hir[p].kind, ExprKind::Dot { obj, .. } if obj == top) =>
                    {
                        top = p
                    }
                    other => break other,
                }
            };
            match root {
                // `isPartOfPossiblyValidTypeOrAbstractComputedPropertyName`
                Parent::MemberKey(_) | Parent::MethodKey(_)
                    if !is_parenthesized(hir, top)
                        && hir
                            .members
                            .iter()
                            .position(|m| m.key == PropKey::Computed(top))
                            .is_some_and(|m| {
                                hir.members[m].flags.contains(Flags::ABSTRACT)
                                    || !matches!(bound.member_owner[m], MemberOwner::Class(_))
                            }) =>
                {
                    continue;
                }
                // `IsInExpressionContext`: a name that is exported as it stands is no expression.
                Parent::Stmt(s)
                    if top == e
                        && !is_parenthesized(hir, e)
                        && s.is_some()
                        && matches!(
                            hir[s].kind,
                            StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                        ) =>
                {
                    continue;
                }
                _ => {}
            }
            if self.is_only_declared(file, e) {
                continue;
            }
            out.push(Diagnostic {
                start: hir[e].pos,
                code,
            });
            self.relate(hir[e].pos, code, |c| {
                let name = c.atom_text(bound.symbols[local.idx()].name);
                c.type_only_declaration_related(c.files().sym(file, local), name)
            });
        }
    }

    /// `NodeFlagsAmbient`: whether `e` is written in what is only declared. The same goes for what `checkVariableLikeDeclaration` does not
    /// look at in a signature without a body: the defaults of its parameters, and a property that is given another name there,
    /// `({ [a]: b }) => void`.
    fn is_only_declared(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let is_left_out = |n: Node| {
            let declaration = hir.parent(n);
            let is_renamed = |p: PatPropId| {
                let value = &hir[hir[p].value];
                matches!(value.kind, PatKind::Ident(_)) && value.pos != hir[p].pos
            };
            let is_part = match hir.data(declaration) {
                NodeData::Param(_) | NodeData::PatElem(_) => hir.initializer(declaration) == n,
                NodeData::PatProp(p) => {
                    hir.initializer(declaration) == n
                        || hir.property_name(declaration) == n && is_renamed(p)
                }
                _ => false,
            };
            let root = hir.get_root_declaration(declaration);
            is_part
                && hir.kind(root) == Kind::Parameter
                && matches!(hir.fns.get(hir.function_of(hir.parent(root)).idx()), Some(function) if matches!(function.body, FnBody::None))
        };
        hir.is_ambient(hir.node(e)) || hir.find_ancestor(hir.node(e), is_left_out).is_some()
    }
}

/// `getFullyQualifiedName`
pub(super) fn fully_qualified_name(c: &mut Checker<'_>, sym: Sym) -> String {
    let name = c.symbol_to_string(sym);
    match c.files().parent_of_symbol(sym) {
        Some(parent) => format!("{}.{name}", fully_qualified_name(c, parent)),
        None => name,
    }
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

/// Where the name after the one that ends at `end` is written: past the dot and what is around it. The text of a declaration file is not
/// kept: there, nothing but the dot is taken to be between them.
fn next_name(text: &[u8], end: u32) -> u32 {
    let dot = skip_trivia(text, end as usize);
    if text.get(dot) == Some(&b'.') {
        skip_trivia(text, dot + 1) as u32
    } else {
        end + 1
    }
}

/// The end of `token` in the statement `export <token> ..` that starts at `pos`. `None` without the text.
fn token_end_after_export(text: &[u8], pos: u32, token: &[u8]) -> Option<u32> {
    let words: [&[u8]; 2] = [b"export", token];
    let mut at = pos as usize;
    for word in words {
        at = skip_trivia(text, at);
        if !text.get(at..)?.starts_with(word) {
            return None;
        }
        at += word.len();
    }
    Some(at as u32)
}
