//! Names of properties, names in namespaces, and what a module exports:
//! 2464, 2694 2713 2724 2749, 1117 1118 1119 2300, 2528 2309 2661, 1361 1362.
//!
//! Follows `checkComputedPropertyName`, `resolveQualifiedName`, `checkGrammarObjectLiteralExpression`, `checkExternalModuleExports`,
//! `checkExportSpecifier`, `getTypeOnlyAliasDeclarationEx` and the end of `onSuccessfullyResolvedSymbol` of TypeScript 7.0.2's
//! checker.go and grammarchecks.go, `IsValidTypeOnlyAliasUseSite` of its ast/utilities.go, and what `declareSymbolEx` of its binder.go
//! says of default exports.

use super::errors::{Diagnostic, is_close};
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, SymbolId};
use smallvec::{SmallVec, smallvec};

/// `typeOnlyDeclaration`: what says `type` on the way from an alias to what it stands for.
#[derive(Copy, Clone)]
enum TypeOnlyStep {
    /// This declaration of this alias.
    Declaration(Sym, Decl),
    /// An `export type *`, the only way this module has this name.
    Star(Sym, Atom),
}

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
            PropKey::Computed(e) => Some((e, m.pos)),
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
            if matches!(bound.expr_parent[e.idx()], Parent::None) {
                continue;
            }
            let ty = self.type_of_expr(file, e);
            if !self.is_known(ty) || self.is_any(ty) || self.is_uncertain(file, e) {
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
        // `SymbolFlagsModuleMember`
        const MODULE_MEMBER: SymFlags = SymFlags::VARIABLE
            .union(SymFlags::FUNCTION)
            .union(SymFlags::CLASS)
            .union(SymFlags::INTERFACE)
            .union(SymFlags::ENUM)
            .union(SymFlags::MODULE)
            .union(SymFlags::TYPE_ALIAS)
            .union(SymFlags::ALIAS);
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
            let found = exported.filter(|&m| files.means(m, wanted)).or_else(|| {
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
                files.all_module_exports(resolved)
            } else {
                files.exports(resolved)
            };
            let is_candidate = |&(other, sym): &(Atom, Sym)| {
                other != known::export_equals
                    && files.flags(sym).intersects(MODULE_MEMBER)
                    && is_close(text, files.atoms.bytes(other))
            };
            let is_misspelt = exports.iter().any(is_candidate);
            if is_misspelt {
                out.push(Diagnostic {
                    start: at,
                    code: 2724,
                });
                self.explain(at, 2724, |c| {
                    // `GetSpellingSuggestion`: of those that are as close, the one declared first.
                    let distance = |other: Atom| edit_distance(text, files.atoms.bytes(other));
                    let suggested = exports
                        .iter()
                        .filter(|&candidate| is_candidate(candidate))
                        .min_by(|a, b| distance(a.0).total_cmp(&distance(b.0)).then(a.1.cmp(&b.1)));
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
            let forced = self.force(ty);
            let reduced = self.reduced(forced);
            let apparent = self.apparent_type(reduced);
            if !self.is_known(forced) || !self.is_known(apparent) {
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
                || matches!(bound.expr_parent[literal.idx()], Parent::None)
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
            if is_all_written {
                written.sort_unstable();
                if written.windows(2).all(|pair| pair[0] != pair[1]) {
                    continue;
                }
            }
            // `declareSymbolEx`: what the table of its members refuses. A method goes with nothing, not even another.
            let mut table: SmallVec<[(Atom, u8, SmallVec<[u32; 2]>); 8]> = SmallVec::new();
            for p in props.iter() {
                let prop = &hir[p];
                let (includes, excludes) = match prop.kind {
                    PropKind::Init | PropKind::Shorthand => (PROPERTY, METHOD),
                    PropKind::Method => (METHOD, METHOD),
                    PropKind::Getter => (GET, METHOD | GET),
                    PropKind::Setter => (SET, METHOD | SET),
                    PropKind::Spread => continue,
                };
                let Some(name) = self.member_name(file, prop.key) else {
                    continue;
                };
                let Some(entry) = table.iter_mut().find(|t| t.0 == name) else {
                    table.push((name, includes, smallvec![prop.pos]));
                    continue;
                };
                // What is there may refuse the newcomer just as well.
                let refused = entry.1 & excludes != 0 || includes == METHOD && entry.1 != 0;
                if !refused {
                    entry.1 |= includes;
                    entry.2.push(prop.pos);
                    continue;
                }
                out.extend(
                    entry
                        .2
                        .iter()
                        .chain(std::iter::once(&prop.pos))
                        .map(|&start| Diagnostic { start, code: 2300 }),
                );
                if entry.1 & (GET | SET) != 0 && entry.1 & (GET | SET) != includes & (GET | SET) {
                    entry.1 |= GET | SET;
                }
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
                if matches!(prop.key, PropKey::Computed(_)) {
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
                let is_global =
                    match self
                        .files()
                        .resolve_name(file, bound.export_scope[x], name, all)
                    {
                        // `IsGlobalSourceFile(GetDeclarationContainer(..))`, of the first declaration: what a module adds to the global scope, or
                        // goes by there, is written in the module.
                        Some(found) => {
                            found.file != file && !self.files().module(found.file).is_module()
                                || self.files().global(name, all) == Some(found)
                                    && self
                                        .files()
                                        .decls(found)
                                        .first()
                                        .is_some_and(|&(f, _)| !self.files().module(f).is_module())
                        }
                        None => matches!(name, known::undefined | known::globalThis),
                    };
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
        // `declareSymbolEx` declares `default` in `GetExports(container.Symbol())`: the file has one table, and all blocks of a namespace or
        // an ambient module share one.
        let defaults = self.default_exports(file, hir.body);
        report_default_export_conflicts(self, file, defaults.iter(), out);
        let mut blocks: Vec<(SymbolId, u32, SmallVec<[DefaultExport; 2]>)> = Vec::new();
        for (m, module) in hir.modules.iter().enumerate() {
            let defaults = self.default_exports(file, module.body);
            if !defaults.is_empty() {
                blocks.push((bound.module_symbol[m], module.name_pos, defaults));
            }
        }
        // The blocks of a symbol are bound in source order.
        blocks.sort_by_key(|block| (block.0, block.1));
        for group in blocks.chunk_by(|a, b| a.0.is_some() && a.0 == b.0) {
            report_default_export_conflicts(
                self,
                file,
                group.iter().flat_map(|block| &block.2),
                out,
            );
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
            if is_ambient && e.is_some() && !is_entity_name_expression(self, file, e) {
                let start = self.start_of(file, e);
                out.push(Diagnostic { start, code: 2714 });
                self.note(start, self.end_of_expr(file, e), 2714, Vec::new());
            }
        }
    }

    /// The declarations of the name `default` among the statements of `body`, in the order the binder declares them.
    fn default_exports(&self, file: FileId, body: IdList<StmtId>) -> SmallVec<[DefaultExport; 2]> {
        const ALIAS: u8 = 1;
        const PROPERTY: u8 = 2;
        const FUNCTION: u8 = 4;
        const CLASS: u8 = 8;
        const INTERFACE: u8 = 16;
        const TYPE_ALIAS: u8 = 32;
        let hir = self.hir(file);
        // `IsImplicitlyExportedJSDocDeclaration`
        let is_top_of_module = (body.start, body.len) == (hir.body.start, hir.body.len)
            && self.files().module(file).is_module();
        let mut defaults: SmallVec<[DefaultExport; 2]> = SmallVec::new();
        let mut declare = |start: u32, statement: StmtId, includes: u8, excludes: u8, code: u32| {
            defaults.push(DefaultExport {
                start,
                statement,
                includes,
                excludes,
                code,
            })
        };
        for s in hir.ids(body) {
            match hir[s].kind {
                // `bindExportAssignment`: `export default x` excludes every earlier declaration of `default`.
                StmtKind::ExportDefault(e) => {
                    let includes = if self.expression_is_alias(file, e) {
                        ALIAS
                    } else {
                        PROPERTY
                    };
                    let start = self.export_assignment_name_start(file, s);
                    let is_missing = matches!(hir[e].kind, ExprKind::Missing);
                    let statement = if start == hir[s].pos || is_missing {
                        s
                    } else {
                        StmtId::NONE
                    };
                    declare(start, statement, includes, u8::MAX, 2528);
                }
                StmtKind::Fn(f) if hir[f].flags.contains(Flags::DEFAULT) => {
                    declare(
                        if hir[f].name.is_some() {
                            hir[f].name_pos
                        } else {
                            hir[s].pos
                        },
                        StmtId::NONE,
                        FUNCTION,
                        PROPERTY,
                        2528,
                    );
                }
                StmtKind::Class(c) if hir[c].flags.contains(Flags::DEFAULT) => {
                    declare(
                        if hir[c].name.is_some() {
                            hir[c].name_pos
                        } else {
                            hir[s].pos
                        },
                        StmtId::NONE,
                        CLASS,
                        PROPERTY | CLASS,
                        2528,
                    );
                }
                StmtKind::Interface(i) if hir[i].flags.contains(Flags::DEFAULT) => {
                    declare(hir[i].name_pos, StmtId::NONE, INTERFACE, 0, 2528)
                }
                StmtKind::ExportNamed(x) => {
                    for spec in hir[x].items.iter() {
                        if hir[spec].exported == known::default {
                            declare(hir[spec].pos, StmtId::NONE, ALIAS, ALIAS, 2528);
                        }
                    }
                }
                // A name like any other that happens to be `default`: no default export.
                StmtKind::ExportStar { alias, .. } if alias == known::default => {
                    if let Some(start) = start_of_namespace_export_name(&hir.text, hir[s].pos) {
                        declare(start, StmtId::NONE, ALIAS, ALIAS, 2300);
                    }
                }
                // So is a `@typedef` of that name, which a module exports.
                StmtKind::TypeAlias(a)
                    if is_top_of_module
                        && hir[a].name == known::default
                        && hir[a].flags.contains(Flags::REPARSED) =>
                {
                    declare(
                        hir[a].name_pos,
                        StmtId::NONE,
                        TYPE_ALIAS,
                        CLASS | INTERFACE | TYPE_ALIAS,
                        2300,
                    );
                }
                _ => {}
            }
        }
        // `bindEachStatementFunctionsFirst`, which works on one statement list. `bindContainer` binds the `@typedef`s of a file last.
        defaults.sort_by_key(|d| match d.includes {
            FUNCTION => 0,
            TYPE_ALIAS => 2,
            _ => 1,
        });
        defaults
    }

    /// `ExpressionIsAlias`
    pub(super) fn expression_is_alias(&self, file: FileId, e: ExprId) -> bool {
        is_entity_name_expression(self, file, e)
            || matches!(self.hir(file)[e].kind, ExprKind::Class(_))
                && !self.is_written_in_parentheses(file, e)
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
            _ if self.is_written_in_parentheses(file, e) => hir[s].pos,
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

    /// `getTypeOnlyAliasDeclarationEx`, asked about values: the first step on the way from the alias `sym` to what it stands for that is
    /// only about types, and whether that step is an export.
    pub(super) fn type_only_alias_declaration(&self, sym: Sym) -> Option<bool> {
        self.type_only_step(sym, &mut 32).map(|step| step.0)
    }

    /// `addTypeOnlyDeclarationRelatedInfo`: 1376 or 1377 at that step. `name`: what the alias goes by where the error is.
    pub(super) fn type_only_declaration_related(
        &self,
        sym: Sym,
        name: String,
    ) -> Vec<super::explain::Related> {
        let Some((is_export, step)) = self.type_only_step(sym, &mut 32) else {
            return Vec::new();
        };
        let place = match step {
            TypeOnlyStep::Declaration(alias, decl) => self.place_of_alias_declaration(alias, decl),
            TypeOnlyStep::Star(module, exported) => {
                self.place_of_type_only_export_star(module, exported)
            }
        };
        match place {
            Some(at) => vec![super::explain::Related {
                at: Some(at),
                code: if is_export { 1377 } else { 1376 },
                args: vec![name],
            }],
            None => Vec::new(),
        }
    }

    /// Whether the step is an export, and the step. `fuel`: how many more aliases are looked at, which is what ends a circle.
    fn type_only_step(&self, mut sym: Sym, fuel: &mut u32) -> Option<(bool, TypeOnlyStep)> {
        let files = self.files();
        loop {
            // What is a value itself is that value, whatever else it stands for.
            let flags = files.flags(sym);
            if *fuel == 0 || !flags.contains(SymFlags::ALIAS) || flags.intersects(SymFlags::VALUE) {
                return None;
            }
            *fuel -= 1;
            let hir = files.hir(sym.file);
            // `getDeclarationOfAliasSymbol`: the last. Whether it says `type`, whether it is an export, the module it names, and the name
            // it takes from that (none: all of it).
            let declared = files.symbol(sym).decls.iter().rev().find_map(|&decl| {
                let (says_type, is_export, spec, name) = match decl {
                    Decl::ImportDefault(i) => {
                        (hir[i].type_only, false, hir[i].spec, known::default)
                    }
                    Decl::ImportNamespace(i) => (hir[i].type_only, false, hir[i].spec, Atom::NONE),
                    Decl::ImportSpec(s) => {
                        let import = hir
                            .imports
                            .iter()
                            .find(|i| i.named.range().contains(&s.idx()))?;
                        (
                            hir[s].type_only || import.type_only,
                            false,
                            import.spec,
                            hir[s].imported,
                        )
                    }
                    Decl::ImportEquals(i) => match hir[i].target {
                        ImportEqualsTarget::Require(spec) => (
                            hir[i].flags.contains(Flags::TYPE_ONLY),
                            false,
                            spec,
                            Atom::NONE,
                        ),
                        // `resolveEntityName`: the `type` of `import type a = b.c` counts once `b` or `b.c` is found to be an alias.
                        ImportEqualsTarget::Entity(names) => {
                            let says_type = hir[i].flags.contains(Flags::TYPE_ONLY) && {
                                let names: Vec<Atom> = hir.ids(names).collect();
                                let scope = files.bound(sym.file).import_equals_scope[i.idx()];
                                (1..=names.len()).any(|n| {
                                    let is_whole = n > 1 && n == names.len();
                                    let meaning = if is_whole {
                                        SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
                                    } else {
                                        SymFlags::NAMESPACE
                                    };
                                    files
                                        .resolve_entity(sym.file, scope, &names[..n], meaning)
                                        .is_some_and(|s| files.flags(s).contains(SymFlags::ALIAS))
                                })
                            };
                            (says_type, false, Atom::NONE, Atom::NONE)
                        }
                    },
                    Decl::ExportSpec(s) => {
                        let export = hir
                            .exports
                            .iter()
                            .find(|x| x.items.range().contains(&s.idx()))?;
                        (
                            hir[s].type_only || export.type_only,
                            true,
                            export.spec,
                            hir[s].local,
                        )
                    }
                    Decl::ExportStarAs(statement) => {
                        let StmtKind::ExportStar {
                            spec, type_only, ..
                        } = hir[statement].kind
                        else {
                            return None;
                        };
                        (type_only, true, spec, Atom::NONE)
                    }
                    _ => return None,
                };
                Some((decl, says_type, is_export, spec, name))
            });
            let mut next = None;
            if let Some((decl, says_type, is_export, spec, name)) = declared {
                let module = if spec.is_some() {
                    files.module_of_specifier(sym.file, spec)
                } else {
                    None
                };
                // `IsNonLocalAlias`: `export = name` is an alias like any other.
                let equals = module
                    .and_then(|m| files.export(m, known::export_equals))
                    .filter(|&equals| {
                        let flags = files.flags(equals);
                        flags.contains(SymFlags::ALIAS)
                            && !flags
                                .intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE)
                    });
                if matches!(decl, Decl::ImportEquals(_))
                    || (name == known::default && module.is_some())
                {
                    // `getTargetOfImportEqualsDeclaration`, `getTargetOfModuleDefault`: the `export =` is what the alias stands for.
                    if says_type {
                        return Some((is_export, TypeOnlyStep::Declaration(sym, decl)));
                    }
                    next = equals;
                } else {
                    // `resolveESModuleSymbol`: what the `export =` goes through holds for all that is taken from the module.
                    if let Some(equals) = equals
                        && let Some(found) = self.type_only_step(equals, fuel)
                    {
                        return Some(found);
                    }
                    // `getTargetOfImportClause`: nothing is made of the default of a module that is not there.
                    if says_type && !matches!(decl, Decl::ImportDefault(_)) {
                        return Some((is_export, TypeOnlyStep::Declaration(sym, decl)));
                    }
                    // `getExportOfModule`: `typeOnlyExportStarMap`. A default never gets here.
                    if name.is_some()
                        && let Some(module) = module
                        && files.is_type_only_star_export(module, name)
                    {
                        return Some((true, TypeOnlyStep::Star(module, name)));
                    }
                }
            }
            sym = match next {
                Some(equals) => equals,
                None => files.alias_target(sym)?,
            };
        }
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
        let is_in_parens = |e: ExprId| hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok();
        // What is said of each name where it is used as a value. It is looked into once, however often it is used.
        // By symbol, once there is a name to ask about. 0: nothing is said.
        const NOT_LOOKED_INTO: u32 = u32::MAX;
        let mut codes: Vec<u32> = Vec::new();
        for &(e, _) in &bound.alias_idents {
            let i = e.idx();
            let local = bound.expr_symbol[i];
            if local.is_none() || matches!(bound.expr_parent[i], Parent::None) {
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
                let is_value = match self.files().resolve_alias(sym) {
                    Some(target) => self.files().flags(target).intersects(SymFlags::VALUE),
                    None => self.is_alias_in_error(sym),
                };
                codes[local.idx()] = match is_value.then(|| self.type_only_alias_declaration(sym)) {
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
                        if !is_in_parens(top)
                            && matches!(hir[p].kind, ExprKind::Dot { obj, .. } if obj == top) =>
                    {
                        top = p
                    }
                    other => break other,
                }
            };
            match root {
                // `isPartOfPossiblyValidTypeOrAbstractComputedPropertyName`
                Parent::MemberKey
                    if !is_in_parens(top)
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
                        && !is_in_parens(e)
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
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The expression the way out has just left.
        let mut inner = e;
        // What is around it. On the way `VarInit`, `FnBody`, `MemberInit` and `ClassExtends` stand for any place in the declaration,
        // the function, the member and the class.
        let mut around = bound.expr_parent[e.idx()];
        loop {
            around = match around {
                Parent::Expr(x) | Parent::Key(x) if x.is_some() => {
                    inner = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::Prop(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::Case(c) => Parent::Stmt(bound.case_stmt[c.idx()]),
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::VarInit(d) if !hir[d].flags.contains(Flags::AMBIENT) => {
                    Parent::Stmt(bound.var_stmt[d.idx()])
                }
                Parent::ParamDefault(p)
                    if matches!(hir[bound.param_fn[p.idx()]].body, FnBody::None) =>
                {
                    return true;
                }
                Parent::ParamDefault(p) => Parent::FnBody(bound.param_fn[p.idx()]),
                Parent::FnBody(f) if !hir[f].flags.contains(Flags::AMBIENT) => {
                    match bound.fns[f.idx()].owner {
                        FnOwner::Expr(x) => Parent::Expr(x),
                        FnOwner::Stmt(s) => Parent::Stmt(s),
                        FnOwner::Member(m) => Parent::MemberInit(m),
                        FnOwner::Type(_) | FnOwner::None => return false,
                    }
                }
                Parent::MemberKey => match hir
                    .members
                    .iter()
                    .position(|m| m.key == PropKey::Computed(inner))
                {
                    Some(m) => Parent::MemberInit(MemberId(m as u32)),
                    None => return false,
                },
                Parent::MemberInit(m) if !hir[m].flags.contains(Flags::AMBIENT) => {
                    match bound.member_owner[m.idx()] {
                        MemberOwner::Class(c) => Parent::ClassExtends(c),
                        _ => return false,
                    }
                }
                Parent::ClassExtends(c) | Parent::Decorator(c, _)
                    if !hir[c].flags.contains(Flags::AMBIENT) =>
                {
                    match bound.class_owner[c.idx()] {
                        ClassOwner::Expr(x) => Parent::Expr(x),
                        ClassOwner::Stmt(s) => Parent::Stmt(s),
                    }
                }
                Parent::VarInit(_)
                | Parent::FnBody(_)
                | Parent::MemberInit(_)
                | Parent::ClassExtends(_)
                | Parent::Decorator(..) => return true,
                // What is in something that is only declared says so itself.
                Parent::EnumInit(m) => {
                    return hir[bound.enum_member_owner[m.idx()]]
                        .flags
                        .contains(Flags::AMBIENT);
                }
                Parent::Module(m) => return hir[m].flags.contains(Flags::AMBIENT),
                Parent::Key(_) | Parent::PatPropDefault(_) | Parent::PatElemDefault(_) => {
                    // The property of a pattern it is the name or the default of, and the pattern it is written in.
                    let prop = match around {
                        Parent::PatPropDefault(p) => Some(p),
                        Parent::Key(_) => hir
                            .pat_props
                            .iter()
                            .position(|p| p.key == PropKey::Computed(inner))
                            .map(|p| PatPropId(p as u32)),
                        _ => None,
                    };
                    let holds_it = |pat: &Pat| match (pat.kind, around, prop) {
                        (PatKind::Array(elems), Parent::PatElemDefault(x), _) => {
                            elems.range().contains(&x.idx())
                        }
                        (PatKind::Object(props), _, Some(p)) => props.range().contains(&p.idx()),
                        _ => false,
                    };
                    let Some(pat) = hir.pats.iter().position(holds_it) else {
                        return false;
                    };
                    match root_declaration(bound, PatId(pat as u32)) {
                        PatParent::Var(d) => Parent::VarInit(d),
                        PatParent::Param(p) => {
                            let f = bound.param_fn[p.idx()];
                            let is_default = !matches!(around, Parent::Key(_));
                            let is_renamed = prop.is_some_and(|x| {
                                let value = &hir[hir[x].value];
                                matches!(value.kind, PatKind::Ident(_)) && value.pos != hir[x].pos
                            });
                            if matches!(hir[f].body, FnBody::None) && (is_default || is_renamed) {
                                return true;
                            }
                            Parent::FnBody(f)
                        }
                        _ => return false,
                    }
                }
                _ => return false,
            };
        }
    }
}

/// A declaration of the name `default` in a table of exports, as `declareSymbolEx` sees it.
struct DefaultExport {
    /// The start of its error span.
    start: u32,
    /// The statement, if the error span is all of it, or is a missing name, which starts later and has no length. `NONE`: it is one
    /// token.
    statement: StmtId,
    /// The symbol flags it adds.
    includes: u8,
    /// The symbol flags it conflicts with.
    excludes: u8,
    /// The diagnostic for a conflict.
    code: u32,
}

/// `declareSymbolEx`, for the declarations of `default` in one table of exports: 2528, 2300. A conflict is reported at the new
/// declaration and at every declaration of the symbol in the table. The new declaration does not join that symbol.
fn report_default_export_conflicts<'a>(
    c: &mut Checker<'_>,
    file: FileId,
    defaults: impl Iterator<Item = &'a DefaultExport>,
    out: &mut Vec<Diagnostic>,
) {
    use super::explain::{NO_LENGTH, Related};
    // Where the error span of a declaration ends.
    let end_of = |c: &Checker<'_>, d: &DefaultExport| {
        if d.statement.is_none() {
            c.end_of_token_at(file, d.start)
        } else if d.start == c.hir(file)[d.statement].pos {
            c.end_of_stmt(file, d.statement)
        } else {
            NO_LENGTH
        }
    };
    let related_at = |c: &Checker<'_>, d: &DefaultExport, code: u32| {
        let end = match end_of(c, d) {
            NO_LENGTH => d.start,
            end => end,
        };
        Related {
            at: Some((file, d.start, end)),
            code,
            args: Vec::new(),
        }
    };
    let mut flags = 0;
    let mut accepted: SmallVec<[&DefaultExport; 2]> = SmallVec::new();
    // Each report: on what, with which code, and what goes with it.
    let mut reports: Vec<(&DefaultExport, u32, Vec<Related>)> = Vec::new();
    for d in defaults {
        if flags & d.excludes == 0 {
            flags |= d.includes;
            accepted.push(d);
            continue;
        }
        // `multipleDefaultExports`
        let are_defaults = d.code == 2528;
        let mut firsts = Vec::new();
        for (index, declared) in accepted.iter().copied().enumerate() {
            let mut another = Vec::new();
            if are_defaults {
                another.push(related_at(&*c, d, if index == 0 { 2753 } else { 6204 }));
                firsts.push(related_at(&*c, declared, 2752));
            }
            reports.push((declared, d.code, another));
        }
        reports.push((d, d.code, firsts));
    }
    out.extend(reports.iter().map(|report| Diagnostic {
        start: report.0.start,
        code: report.1,
    }));
    // `compactAndMergeRelatedInfos`: the reports of one error are one, with what goes with any of them in the order of errors.
    reports.sort_by_key(|report| (report.0.start, report.1));
    for same in reports.chunk_by(|a, b| (a.0.start, a.1) == (b.0.start, b.1)) {
        let (declared, code) = (same[0].0, same[0].1);
        let mut related: Vec<Related> = same.iter().flat_map(|r| r.2.iter().cloned()).collect();
        if same.len() > 1 {
            related.sort_by_key(|r| (r.at, r.code));
            related.dedup();
        }
        if declared.statement.is_some() {
            let end = end_of(&*c, declared);
            c.note(declared.start, end, code, Vec::new());
        }
        if !related.is_empty() {
            c.relate(declared.start, code, |_| related);
        }
    }
}

/// `getFullyQualifiedName`
pub(super) fn fully_qualified_name(c: &mut Checker<'_>, sym: Sym) -> String {
    let files = c.files();
    let symbol = files.symbol(sym);
    let name = c.symbol_to_string(sym);
    if symbol.parent.is_none() {
        return name;
    }
    let parent = files.sym(sym.file, symbol.parent);
    // What is not exported has no parent (`declareModuleMember`).
    if files.export(parent, symbol.name) != Some(sym) {
        return name;
    }
    format!("{}.{name}", fully_qualified_name(c, parent))
}

/// What `levenshteinWithMax` measures: changing a letter costs two, and changing its case next to nothing.
fn edit_distance(a: &[u8], b: &[u8]) -> f64 {
    let mut previous: Vec<f64> = (0..=b.len()).map(|j| j as f64).collect();
    let mut current = vec![0.0; b.len() + 1];
    for (i, x) in a.iter().enumerate() {
        current[0] = (i + 1) as f64;
        for (j, y) in b.iter().enumerate() {
            current[j + 1] = if x == y {
                previous[j]
            } else {
                let change = previous[j] + if x.eq_ignore_ascii_case(y) { 0.1 } else { 2.0 };
                (previous[j + 1] + 1.0).min(current[j] + 1.0).min(change)
            };
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

/// `IsEntityNameExpression`. A missing expression is an empty Identifier (`createMissingIdentifier`).
fn is_entity_name_expression(c: &Checker<'_>, file: FileId, mut e: ExprId) -> bool {
    let hir = c.hir(file);
    loop {
        if c.is_written_in_parentheses(file, e) {
            return false;
        }
        match hir[e].kind {
            ExprKind::Ident(_) | ExprKind::Missing => return true,
            ExprKind::Dot { obj, name, .. } if !c.files().atoms.bytes(name).starts_with(b"#") => {
                e = obj
            }
            _ => return false,
        }
    }
}

/// `GetRootDeclaration`: the variable or the parameter whose binding pattern contains `pat`.
fn root_declaration(bound: &Bound, mut pat: PatId) -> PatParent {
    loop {
        match bound.pat_parent[pat.idx()] {
            PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
            root => return root,
        }
    }
}

/// `SkipTrivia`: past the blanks and comments at `at`.
fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(c) if c.is_ascii_whitespace() || *c == 0x0b => at += 1,
            Some(b'/') if text.get(at + 1) == Some(&b'/') => {
                while text.get(at).is_some_and(|&c| c != b'\n' && c != b'\r') {
                    at += 1;
                }
            }
            Some(b'/') if text.get(at + 1) == Some(&b'*') => {
                at = text[at + 2..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map_or(text.len(), |n| at + n + 4);
            }
            _ => return at,
        }
    }
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

/// Where the name of `export * as name from "m"` is written. `pos`: where the statement starts. Not to be told without the text.
fn start_of_namespace_export_name(text: &[u8], pos: u32) -> Option<u32> {
    let words: [&[u8]; 4] = [b"export", b"type", b"*", b"as"];
    let mut at = pos as usize;
    for word in words {
        at = skip_trivia(text, at);
        if text.get(at..)?.starts_with(word) {
            at += word.len();
        } else if word != b"type" {
            return None;
        }
    }
    Some(skip_trivia(text, at) as u32)
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
