//! The members whose names the checker resolves: `getResolvedMembersOrExportsOfSymbol`,
//! `lateBindMember`, `addDeclarationToLateBoundSymbol`, `mergeSymbol`, `getLateBoundSymbol`.

use super::*;
use crate::bind::{Decl, flags_of_member, flags_of_property};
use crate::program::get_excluded_symbol_flags;

/// What `lateBindMember` and `combineSymbolTables` report.
pub(super) enum LateBoundConflict {
    /// `lateBindMember`: the name, the declarations of the symbols with that name, early and late,
    /// and the declaration that conflicts with them.
    Refused(Atom, Vec<(FileId, Decl)>, (FileId, Decl)),
    /// `reportMergeSymbolError`: the declarations of the early bound symbol, those of the late bound
    /// one, and the flags of both.
    NotMerged(Vec<(FileId, Decl)>, Vec<(FileId, Decl)>, SymFlags),
    /// `mergeSymbol`, 2649: the first declaration of the late bound symbol, and the early bound
    /// one, which is also a namespace.
    NonModuleEntity((FileId, Decl), Sym),
}

/// The symbols with `CheckFlagsLate` of one side of a container, after `combineSymbolTables`.
pub(super) struct LateBoundSymbols {
    /// `symbol.Declarations` of each: those of the early bound symbol of that name come first, if
    /// the two merge. Those of the target of an early bound alias are left out.
    declarations: Vec<Vec<(FileId, Decl)>>,
    /// Index of the symbol that a declaration belongs to.
    symbol_of: FxHashMap<(FileId, Decl), u32>,
    /// `mergeSymbol`, by name: what the table has in place of an early bound alias. The target of
    /// the alias, which the late bound symbol is merged into, or `None`: the late bound symbol.
    replaced_aliases: Vec<(Atom, Option<Sym>)>,
    pub(super) conflicts: Vec<LateBoundConflict>,
}

/// `None`: the container has no late-bound member on that side.
pub(super) type LateBoundMembers = Option<std::rc::Rc<LateBoundSymbols>>;

impl<'p, 's> Checker<'p, 's> {
    /// `getSymbolOfDeclaration(declaration).Declarations`, once the members of its parent are
    /// resolved.
    pub(super) fn declarations_of_member(
        &mut self,
        file: FileId,
        declaration: Decl,
    ) -> List<'p, (FileId, Decl)> {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let symbol = bound.symbol_of_declaration(declaration);
        if symbol.is_none() {
            return match declaration {
                // "A symbol already exists, so don't add this as a declaration."
                Decl::ThisProperty(_) => List::default(),
                _ => List::One((file, declaration)),
            };
        }
        let (parent, name) = (
            bound.symbols[symbol.idx()].parent,
            bound.symbols[symbol.idx()].name,
        );
        let is_static = match declaration {
            Decl::Member(member) => hir[member].flags.contains(Flags::STATIC),
            Decl::Expando(_) => true,
            Decl::ThisProperty(_) if parent.is_some() => {
                bound.lookup(bound.symbols[parent.idx()].exports, name) == Some(symbol)
            }
            _ => false,
        };
        // `getLateBoundSymbol`: `hasLateBindableName` comes before the members of the parent are
        // requested, while their links are empty. So a name whose type needs those members closes
        // a cycle here, and none where the members are requested first.
        let key = match declaration {
            Decl::Member(member) => hir[member].key,
            Decl::Property(property) => hir[property].key,
            _ => PropKey::None,
        };
        if name == known::computed
            && matches!(key, PropKey::Computed(_))
            && self.declared_member_name(file, key).is_none()
        {
            return files.decls_of(files.sym(file, symbol));
        }
        if parent.is_some()
            && let Some(late) = self.late_bound_members(files.sym(file, parent), is_static)
            && let Some(&symbol) = late.symbol_of.get(&(file, declaration))
        {
            return List::Own(late.declarations[symbol as usize].clone());
        }
        files.decls_of(files.sym(file, symbol))
    }

    /// `getSymbolOfDeclaration(declaration).Declarations` at this moment. `getLateBoundSymbol` asks
    /// for the members of the parent only for a `__computed` symbol, and `getMergedSymbol` of any
    /// other symbol is the binder's until `combineSymbolTables` has cloned it.
    pub(super) fn declarations_of_symbol_of_declaration(
        &mut self,
        file: FileId,
        declaration: Decl,
    ) -> List<'p, (FileId, Decl)> {
        let (bound, files) = (self.bound(file), self.files());
        let symbol = bound.symbol_of_declaration(declaration);
        if symbol.is_some() && bound.symbols[symbol.idx()].name != known::computed {
            let parent = bound.symbols[symbol.idx()].parent;
            let is_static = matches!(declaration, Decl::Member(member)
                if self.hir(file)[member].flags.contains(Flags::STATIC));
            if parent.is_some()
                && !(self.late_bound_members).contains_key(&(files.sym(file, parent), is_static))
            {
                return files.decls_of(files.sym(file, symbol));
            }
        }
        self.declarations_of_member(file, declaration)
    }

    /// `getExportsOfSymbol(container)[name]`, where the binder's table has the alias `early`.
    /// `None`: the late bound symbol of that name.
    pub(super) fn resolved_export_of_alias(
        &mut self,
        container: Sym,
        name: Atom,
        early: Sym,
    ) -> Option<Sym> {
        let Some(late) = self.late_bound_members(container, true) else {
            return Some(early);
        };
        let mut replaced_aliases = late.replaced_aliases.iter();
        match replaced_aliases.find(|it| it.0 == name) {
            Some(&(_, replaced_by)) => replaced_by,
            None => Some(early),
        }
    }

    /// `getResolvedMembersOrExportsOfSymbol`, only what it adds to the binder's tables.
    pub(super) fn late_bound_members(
        &mut self,
        container: Sym,
        is_static: bool,
    ) -> LateBoundMembers {
        if let Some(known) = self.late_bound_members.get(&(container, is_static)) {
            return known.clone();
        }
        // `links[resolutionKind] = earlySymbols` comes before the late-bound members are added: a recursive query gets the early-bound
        // members alone.
        self.late_bound_members.insert((container, is_static), None);
        let files = self.files();
        // `getMembersOfDeclaration`: those with a dynamic name, each with `decl.Symbol().Flags`.
        let mut computed: Vec<(FileId, Decl, PropKey, SymFlags)> = Vec::new();
        for &(file, decl) in files.decls_of(container).iter() {
            let hir = self.hir(file);
            let is_dynamic =
                |key: PropKey| matches!(key, PropKey::Computed(e) if is_dynamic_name(hir, e));
            let members = match decl {
                Decl::Class(it) => hir[it].members,
                Decl::Interface(it) => hir[it].members,
                Decl::TypeLiteral(node) => match hir[node].kind {
                    TypeNodeKind::Object(members) => members,
                    _ => continue,
                },
                Decl::ObjectLiteral(e) => {
                    let ExprKind::Object(props) = hir[e].kind else {
                        continue;
                    };
                    for p in props.iter().filter(|&p| is_dynamic(hir[p].key)) {
                        if let Some(flags) = flags_of_property(hir[p].kind) {
                            computed.push((file, Decl::Property(p), hir[p].key, flags.0));
                        }
                    }
                    continue;
                }
                _ => continue,
            };
            for m in members.iter().filter(|&m| is_dynamic(hir[m].key)) {
                if let Some(flags) = flags_of_member(&hir[m])
                    && hir[m].flags.contains(Flags::STATIC) == is_static
                {
                    computed.push((file, Decl::Member(m), hir[m].key, flags.0));
                }
            }
        }
        // `checkObjectLiteral` uses the exports as the binder produced them.
        if is_static
            && !files.flags(container).contains(SymFlags::OBJECT_LITERAL)
            && let Some(assignments) = files.export(container, known::assignment_declaration)
        {
            for &(file, decl) in files.decls_of(assignments).iter() {
                let hir = self.hir(file);
                if let Decl::Expando(e) | Decl::ThisProperty(e) = decl
                    && let ExprKind::Assign { target, .. } = hir[e].kind
                    && let ExprKind::Index { index, .. } = hir[target].kind
                {
                    let bound = self.bound(file);
                    let flags = bound.symbols[bound.symbol_of_declaration(decl).idx()].flags;
                    computed.push((file, decl, PropKey::Computed(index), flags));
                }
            }
        }
        let early_symbol = |name: Atom| match is_static {
            true => files.export(container, name),
            false => files.member(container, name),
        };
        // `lateBindMember`. `symbol.Flags` and `symbol.Declarations`, and which symbol `lateSymbols` has under a name.
        let mut late: Vec<(SymFlags, Vec<(FileId, Decl)>)> = Vec::new();
        let mut late_symbols: Vec<(Atom, usize)> = Vec::new();
        // `links.lateSymbol` of the declarations that are not among `symbol.Declarations`.
        let mut unlisted: Vec<((FileId, Decl), u32)> = Vec::new();
        let mut conflicts = Vec::new();
        self.late_binding
            .push((self.stack.len(), container, is_static));
        for (file, declaration, key, flags) in computed {
            // `hasLateBindableName`
            let Some(name) = self.declared_member_name(file, key) else {
                continue;
            };
            let mut index = match late_symbols.iter().find(|it| it.0 == name) {
                Some(it) => it.1,
                None => {
                    late_symbols.push((name, late.len()));
                    late.len()
                }
            };
            if let Some(there) = late.get_mut(index)
                && there.0.intersects(get_excluded_symbol_flags(flags))
            {
                // "If we have an existing early-bound member, combine its declarations so that we can report an error at each
                // declaration."
                let mut declarations = early_symbol(name).map_or(Vec::new(), |it| files.decls(it));
                declarations.extend_from_slice(&there.1);
                conflicts.push(LateBoundConflict::Refused(
                    name,
                    declarations,
                    (file, declaration),
                ));
                let accessor = SymFlags::ACCESSOR;
                if there.0.intersects(accessor) && there.0 & accessor != flags & accessor {
                    there.0 |= accessor;
                }
                index = late.len();
            }
            if index == late.len() {
                late.push((SymFlags::empty(), Vec::new()));
            }
            // `addDeclarationToLateBoundSymbol`
            let symbol = &mut late[index];
            if symbol.1.is_empty() || !flags.contains(SymFlags::REPLACEABLE_BY_METHOD) {
                symbol.0 |= flags;
                symbol.1.push((file, declaration));
            } else {
                unlisted.push(((file, declaration), index as u32));
            }
        }
        self.late_binding.pop();
        // `combineSymbolTables`: `mergeSymbol(target, source)` for each name that both tables have.
        let mut replaced_aliases = Vec::new();
        for (name, index) in late_symbols {
            let Some(target) = early_symbol(name) else {
                continue;
            };
            let (target_flags, source) = (files.flags(target), &late[index]);
            let source_flags = source.0;
            let is_excluded = |flags: SymFlags| {
                flags.intersects(get_excluded_symbol_flags(source_flags))
                    && !(source_flags | flags).contains(SymFlags::ASSIGNMENT)
            };
            let not_merged = || {
                let (early, late) = (files.decls(target), source.1.clone());
                LateBoundConflict::NotMerged(early, late, target_flags | source_flags)
            };
            if is_excluded(target_flags) {
                conflicts.push(match target_flags.contains(SymFlags::NAMESPACE_MODULE) {
                    true => LateBoundConflict::NonModuleEntity(source.1[0], target),
                    false => not_merged(),
                });
                continue;
            }
            let resolved_target = match target_flags.contains(SymFlags::TRANSIENT) {
                true => AliasTarget::Symbol(target),
                false => self.resolve_symbol(target),
            };
            match resolved_target {
                AliasTarget::Symbol(resolved) if resolved == target => {
                    late[index].1.splice(0..0, files.decls(target));
                }
                AliasTarget::Symbol(resolved) if !is_excluded(files.flags(resolved)) => {
                    replaced_aliases.push((name, Some(resolved)));
                }
                // "return source"
                _ => {
                    if resolved_target != AliasTarget::Unknown {
                        conflicts.push(not_merged());
                    }
                    replaced_aliases.push((name, None));
                }
            }
        }
        let late: LateBoundMembers = (!late.is_empty()).then(|| {
            let declarations: Vec<_> = late.into_iter().map(|symbol| symbol.1).collect();
            let symbol_of = declarations
                .iter()
                .zip(0..)
                .flat_map(|(symbol, index)| {
                    symbol.iter().map(move |&declaration| (declaration, index))
                })
                .chain(unlisted)
                .collect();
            std::rc::Rc::new(LateBoundSymbols {
                declarations,
                symbol_of,
                replaced_aliases,
                conflicts,
            })
        });
        self.late_bound_members
            .insert((container, is_static), late.clone());
        late
    }
}
