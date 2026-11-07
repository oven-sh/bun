//! Late-bound members, whose computed names the checker has to resolve: `getResolvedMembersOrExportsOfSymbol`,
//! `lateBindMember`, `addDeclarationToLateBoundSymbol`, `mergeSymbol`, `getLateBoundSymbol`.

use super::*;
use crate::bind::{Decl, SymbolId, flags_of_member, flags_of_property, replaces_value_declaration};
use crate::program::get_excluded_symbol_flags;

/// An error that `lateBindMember` or `combineSymbolTables` reports.
#[derive(Clone)]
pub(super) enum LateBoundConflict {
    /// From `lateBindMember`. Fields: the name, the declarations of the early- and late-bound
    /// symbols with that name, and the declaration that conflicts with them.
    Duplicate(Atom, Vec<(FileId, Decl)>, (FileId, Decl)),
    /// From `reportMergeSymbolError`. Fields: the early-bound symbol's declarations, the late-bound
    /// symbol's declarations, and both symbols' flags.
    NotMerged(Vec<(FileId, Decl)>, Vec<(FileId, Decl)>, SymFlags),
    /// From `mergeSymbol`, error 2649. Fields: the late-bound symbol's first declaration, and the
    /// early-bound symbol, which is also a namespace.
    NonModuleEntity((FileId, Decl), Sym),
}

/// A symbol with `CheckFlagsLate`. If `combineSymbolTables` merged it with an early-bound symbol,
/// this is the clone of the early-bound symbol instead.
struct LateBoundSymbol {
    /// `symbol.Flags`
    flags: SymFlags,
    /// `symbol.Declarations`, the early-bound symbol's first. Skips the declarations of an early-bound alias's target.
    declarations: Vec<(FileId, Decl)>,
    /// `symbol.ValueDeclaration`
    value_declaration: Option<(FileId, Decl)>,
    /// `getMergedSymbol(symbol).CheckFlags&CheckFlagsLate != 0`. `cloneSymbol` doesn't copy the flag.
    is_late: bool,
}

/// The symbols that `getResolvedMembersOrExportsOfSymbol` adds to the binder's table for one side
/// of a container (members or exports).
pub(super) struct LateBoundSymbols {
    symbols: Vec<LateBoundSymbol>,
    /// Maps a declaration to its symbol's index in `symbols`.
    symbol_of: FxHashMap<(FileId, Decl), u32>,
    /// `mergeSymbol`: what replaces an early-bound alias in the table, by name. `Some` is the alias's
    /// target, which the late-bound symbol was merged into. `None` is the late-bound symbol itself.
    replaced_aliases: Vec<(Atom, Option<Sym>)>,
    /// Declarations with a late-bindable name whose `links.resolvedSymbol` another call had already
    /// set. Their symbols are in that call's table.
    bound_by_another_call: Vec<(FileId, Decl)>,
    pub(super) conflicts: Vec<LateBoundConflict>,
}

/// `None` if the container has no late-bound members on that side.
pub(super) type LateBoundMembers = Option<std::rc::Rc<LateBoundSymbols>>;

const RECENT_SIDES: usize = 64;

const NO_SIDE: (Sym, bool) = (
    Sym {
        file: FileId(u32::MAX),
        id: SymbolId::NONE,
    },
    false,
);

pub(super) struct LateBoundSides {
    known: FxHashMap<(Sym, bool), LateBoundMembers>,
    recent_without_members: [(Sym, bool); RECENT_SIDES],
}

impl Default for LateBoundSides {
    fn default() -> Self {
        LateBoundSides {
            known: FxHashMap::default(),
            recent_without_members: [NO_SIDE; RECENT_SIDES],
        }
    }
}

impl LateBoundSides {
    #[inline]
    fn recent_position_of(side: (Sym, bool)) -> usize {
        (side.0.id.idx() * 2 + usize::from(side.1)) % RECENT_SIDES
    }

    #[inline]
    fn find(&mut self, side: (Sym, bool)) -> Option<LateBoundMembers> {
        let recent = &mut self.recent_without_members[Self::recent_position_of(side)];
        if *recent == side {
            return Some(None);
        }
        let known = self.known.get(&side)?;
        if known.is_none() {
            *recent = side;
        }
        Some(known.clone())
    }

    fn get(&self, side: (Sym, bool)) -> Option<&LateBoundMembers> {
        self.known.get(&side)
    }

    fn contains(&self, side: (Sym, bool)) -> bool {
        self.known.contains_key(&side)
    }

    fn insert(&mut self, side: (Sym, bool), members: LateBoundMembers) {
        let recent = &mut self.recent_without_members[Self::recent_position_of(side)];
        if *recent == side {
            *recent = NO_SIDE;
        }
        self.known.insert(side, members);
    }

    pub(super) fn retain(
        &mut self,
        is_kept: impl FnMut(&(Sym, bool), &mut LateBoundMembers) -> bool,
    ) {
        self.recent_without_members = [NO_SIDE; RECENT_SIDES];
        self.known.retain(is_kept);
    }

    pub(super) fn len(&self) -> usize {
        self.known.len()
    }
}

/// `SetValueDeclaration`
fn set_value_declaration(value_declaration: &mut Option<(FileId, Decl)>, node: (FileId, Decl)) {
    if replaces_value_declaration(value_declaration.map(|it| it.1), node.1) {
        *value_declaration = Some(node);
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `getSymbolOfDeclaration(declaration)` after resolving its parent's members. Returns the parent's
    /// `LateBoundSymbols` and the symbol's index in it, or `None` if resolving didn't add the symbol.
    fn late_bound_symbol(
        &mut self,
        file: FileId,
        declaration: Decl,
    ) -> Option<(std::rc::Rc<LateBoundSymbols>, usize)> {
        let bound = self.bound(file);
        let symbol = bound.symbol_of_declaration(declaration);
        self.late_bound_symbol_among(file, declaration, bound, symbol)
    }

    #[inline]
    fn sym_among(&self, file: FileId, bound: &Bound<'s>, id: SymbolId) -> Sym {
        if bound.symbol(id).flags.contains(SymFlags::MERGED) {
            return self.files().sym(file, id);
        }
        Sym { file, id }
    }

    fn late_bound_symbol_among(
        &mut self,
        file: FileId,
        declaration: Decl,
        bound: &'p Bound<'s>,
        symbol: SymbolId,
    ) -> Option<(std::rc::Rc<LateBoundSymbols>, usize)> {
        if symbol.is_none() {
            return None;
        }
        let hir = self.hir(file);
        let (parent, name) = (bound.symbol(symbol).parent, bound.symbol(symbol).name);
        let is_static = match declaration {
            Decl::Member(member) => hir[member].flags.contains(Flags::STATIC),
            Decl::Expando(_) => true,
            Decl::ThisProperty(_) if parent.is_some() => {
                bound.lookup(bound.symbol(parent).exports, name) == Some(symbol)
            }
            _ => false,
        };
        // `getLateBoundSymbol` calls `hasLateBindableName` before it requests the parent's members,
        // while their links are still empty. So a name whose type needs those members is circular
        // here, but not where the members are requested first.
        let key = match declaration {
            Decl::Member(member) => hir[member].key,
            Decl::Property(property) => hir[property].key,
            _ => PropKey::None,
        };
        if name == known::computed
            && matches!(key, PropKey::Computed(_))
            && self.declared_member_name(file, key).is_none()
            || parent.is_none()
        {
            return None;
        }
        let side = (self.sym_among(file, bound, parent), is_static);
        let requests_members_itself =
            name == known::computed && matches!(declaration, Decl::Member(_));
        if requests_members_itself {
            self.late_binding_by_symbol.push(side);
        }
        let late = self.late_bound_members(side.0, is_static);
        if requests_members_itself {
            self.late_binding_by_symbol.pop();
        }
        let late = late?;
        let symbol = *late.symbol_of.get(&(file, declaration))?;
        Some((late, symbol as usize))
    }

    /// `declaration.Symbol().Declarations`
    fn declarations_of_early_bound_symbol(
        &self,
        file: FileId,
        declaration: Decl,
        symbol: SymbolId,
    ) -> List<'p, (FileId, Decl)> {
        let files = self.files();
        match declaration {
            _ if symbol.is_some() => files.decls_of(files.sym(file, symbol)),
            // "A symbol already exists, so don't add this as a declaration."
            Decl::ThisProperty(_) => List::default(),
            _ => List::One((file, declaration)),
        }
    }

    /// `getSymbolOfDeclaration(declaration).Declarations` after resolving its parent's members.
    pub(super) fn declarations_of_member(
        &mut self,
        file: FileId,
        declaration: Decl,
    ) -> List<'p, (FileId, Decl)> {
        let bound = self.bound(file);
        let early = bound.symbol_of_declaration(declaration);
        match self.late_bound_symbol_among(file, declaration, bound, early) {
            Some((late, symbol)) => List::Own(late.symbols[symbol].declarations.clone()),
            None => self.declarations_of_early_bound_symbol(file, declaration, early),
        }
    }

    /// `EmitResolver.IsLateBound`
    pub(super) fn is_late_bound(&mut self, file: FileId, m: MemberId) -> bool {
        match self.late_bound_symbol(file, Decl::Member(m)) {
            Some((late, symbol)) => late.symbols[symbol].is_late,
            None => self.is_late_bound_by_another_call(file, m),
        }
    }

    /// `symbol.Flags`, `symbol.ValueDeclaration` and `symbol.Declarations` of a property's symbol.
    pub(super) fn merged_symbol_of_property(
        &mut self,
        sym: Sym,
    ) -> (SymFlags, Option<(FileId, Decl)>, List<'p, (FileId, Decl)>) {
        let files = self.files();
        let bound_of_property = self.bound(sym.file);
        let property = bound_of_property.symbol(sym.id);
        let is_merged = property.flags.contains(SymFlags::MERGED);
        let declarations = match property.decls {
            [only] if !is_merged => List::One((sym.file, *only)),
            _ => files.decls_of(sym),
        };
        let Some(&(file, first)) = declarations.first() else {
            cold_path();
            return (property.flags, None, List::default());
        };
        let bound = match file == sym.file {
            true => bound_of_property,
            false => self.bound(file),
        };
        let early = bound.symbol_of_declaration(first);
        match self.late_bound_symbol_among(file, first, bound, early) {
            Some((late, symbol)) => {
                cold_path();
                let symbol = &late.symbols[symbol];
                let declarations = List::Own(symbol.declarations.clone());
                (symbol.flags, symbol.value_declaration, declarations)
            }
            None => (
                property.flags,
                match is_merged {
                    true => files.value_declaration(sym),
                    false => {
                        let index = property.value_declaration as usize;
                        property.decls.get(index).map(|&it| (sym.file, it))
                    }
                },
                if early.is_some() && self.sym_among(file, bound, early) == sym {
                    declarations
                } else {
                    self.declarations_of_early_bound_symbol(file, first, early)
                },
            ),
        }
    }

    /// `getSymbolOfDeclaration(declaration).Declarations` as of now. `getLateBoundSymbol` resolves
    /// the parent's members only for a `__computed` symbol. For any other symbol, `getMergedSymbol`
    /// returns the binder's symbol until `combineSymbolTables` clones it.
    pub(super) fn declarations_of_symbol_of_declaration(
        &mut self,
        file: FileId,
        declaration: Decl,
    ) -> List<'p, (FileId, Decl)> {
        let (bound, files) = (self.bound(file), self.files());
        let symbol = bound.symbol_of_declaration(declaration);
        if symbol.is_some() && bound.symbol(symbol).name != known::computed {
            let parent = bound.symbol(symbol).parent;
            let is_static = matches!(declaration, Decl::Member(member)
                if self.hir(file)[member].flags.contains(Flags::STATIC));
            if parent.is_some()
                && !(self.late_bound_members).contains((files.sym(file, parent), is_static))
            {
                return files.decls_of(files.sym(file, symbol));
            }
        }
        self.declarations_of_member(file, declaration)
    }

    /// Same as `declarations_of_symbol_of_declaration`, for use while `declaration` is being checked. By then
    /// `checkIndexConstraints` has resolved the members of a class or interface, and `checkObjectLiteral` has
    /// requested every member's symbol. `checkTypeLiteral` checks the members first.
    pub(super) fn declarations_of_symbol_of_checked_declaration(
        &mut self,
        file: FileId,
        declaration: Decl,
    ) -> List<'p, (FileId, Decl)> {
        match declaration {
            Decl::Member(m)
                if matches!(
                    self.bound(file).member_owner[m.idx()],
                    crate::bind::MemberOwner::TypeLiteral(_)
                ) =>
            {
                self.declarations_of_symbol_of_declaration(file, declaration)
            }
            _ => self.declarations_of_member(file, declaration),
        }
    }

    /// `getExportsOfSymbol(container)[name]` when the binder's table has the alias `early` there.
    /// `None` means the late-bound symbol with that name.
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

    /// True if `m`, which has a late-bindable name, is missing from its container's table because
    /// `lateBindMember` binds each declaration only once.
    pub(super) fn is_late_bound_by_another_call(&mut self, file: FileId, m: MemberId) -> bool {
        let bound = self.bound(file);
        let Some(symbol) = bound.symbols.get(bound.member_symbol[m.idx()].idx()) else {
            return false;
        };
        if symbol.parent.is_none() {
            return false;
        }
        let container = self.files().sym(file, symbol.parent);
        let is_static = self.hir(file)[m].flags.contains(Flags::STATIC);
        let late = self.late_bound_members(container, is_static);
        late.is_some_and(|late| {
            late.bound_by_another_call
                .contains(&(file, Decl::Member(m)))
        })
    }

    /// `getResolvedMembersOrExportsOfSymbol`, but returns only what it adds to the binder's tables.
    pub(super) fn late_bound_members(
        &mut self,
        container: Sym,
        is_static: bool,
    ) -> LateBoundMembers {
        match self.late_bound_members.find((container, is_static)) {
            Some(known) => known,
            None => self.resolve_late_bound_members(container, is_static),
        }
    }

    #[inline(never)]
    fn resolve_late_bound_members(&mut self, container: Sym, is_static: bool) -> LateBoundMembers {
        let side = (container, is_static);
        let files = self.files();
        // `links[resolutionKind] = earlySymbols` runs before the late-bound members are added, so a
        // recursive query gets only the early-bound members. If `symbol.Members` is nil, the links
        // stay nil too and a recursive query starts over. `symbol.Exports` is never nil: it has
        // `prototype`, or the symbol that `addLateBoundAssignmentDeclarationToSymbol` adds.
        if is_static || files.has_members_table(container) {
            self.late_bound_members.insert(side, None);
        }
        // `getMembersOfDeclaration`: the members with a dynamic name, each with its `decl.Symbol().Flags`.
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
                    && let ExprKind::Index { index, .. } = hir.checked_kind(target)
                {
                    let bound = self.bound(file);
                    let flags = bound.symbol(bound.symbol_of_declaration(decl)).flags;
                    computed.push((file, decl, PropKey::Computed(index), flags));
                }
            }
        }
        let early_symbol = |name: Atom| match is_static {
            true => files.export(container, name),
            false => files.member(container, name),
        };
        // `lateBindMember`. `late_symbols` is its `lateSymbols` table: name to index in `late`.
        let mut late: Vec<LateBoundSymbol> = Vec::new();
        let mut late_symbols: Vec<(Atom, usize)> = Vec::new();
        // The names in `late_symbols`, in the same order.
        let mut late_names = OrderedSet::default();
        // `links.lateSymbol` of the declarations that aren't in `symbol.Declarations`.
        let mut unlisted: Vec<((FileId, Decl), u32)> = Vec::new();
        let mut bound_by_another_call = Vec::new();
        let mut conflicts = Vec::new();
        // A call that started over hasn't stored anything in the links either, so only the outermost call is recorded.
        let is_outermost = !self.late_binding.iter().any(|it| (it.1, it.2) == side);
        if is_outermost {
            self.late_binding
                .push((self.stack.len(), container, is_static));
        }
        for &(file, declaration, key, flags) in &computed {
            // `hasLateBindableName`
            let Some(name) = self.declared_member_name(file, key) else {
                continue;
            };
            // `links.resolvedSymbol == nil`
            if !self.late_bound_declarations.insert((file, declaration)) {
                bound_by_another_call.push((file, declaration));
                continue;
            }
            let mut index = match late_names.insert_full(name) {
                (at, false) => late_symbols[at].1,
                (_, true) => {
                    late_symbols.push((name, late.len()));
                    late.len()
                }
            };
            if let Some(there) = late.get_mut(index)
                && there.flags.intersects(get_excluded_symbol_flags(flags))
            {
                // "If we have an existing early-bound member, combine its declarations so that we
                // can report an error at each declaration."
                let mut declarations =
                    early_symbol(name).map_or(Vec::new(), |it| files.decls_of(it).into_vec());
                declarations.extend_from_slice(&there.declarations);
                conflicts.push(LateBoundConflict::Duplicate(
                    name,
                    declarations,
                    (file, declaration),
                ));
                let accessor = SymFlags::ACCESSOR;
                if there.flags.intersects(accessor) && there.flags & accessor != flags & accessor {
                    there.flags |= accessor;
                }
                index = late.len();
            }
            if index == late.len() {
                late.push(LateBoundSymbol {
                    flags: SymFlags::empty(),
                    declarations: Vec::new(),
                    value_declaration: None,
                    is_late: true,
                });
            }
            // `addDeclarationToLateBoundSymbol`
            let symbol = &mut late[index];
            if symbol.declarations.is_empty() || !flags.contains(SymFlags::REPLACEABLE_BY_METHOD) {
                symbol.flags |= flags;
                symbol.declarations.push((file, declaration));
            } else {
                unlisted.push(((file, declaration), index as u32));
            }
            if flags.intersects(SymFlags::VALUE) {
                set_value_declaration(&mut symbol.value_declaration, (file, declaration));
            }
        }
        if is_outermost {
            self.late_binding.pop();
            for it in &computed {
                self.late_bound_declarations.remove(&(it.0, it.1));
            }
        }
        // `combineSymbolTables`: `mergeSymbol(target, source)` for each name that both tables have.
        let mut replaced_aliases = Vec::new();
        for (name, index) in late_symbols {
            let Some(target) = early_symbol(name) else {
                continue;
            };
            let (target_flags, source) = (files.flags(target), &late[index]);
            let source_flags = source.flags;
            let is_excluded = |flags: SymFlags| {
                flags.intersects(get_excluded_symbol_flags(source_flags))
                    && !(source_flags | flags).contains(SymFlags::ASSIGNMENT)
            };
            let not_merged = || {
                let (early, late) = (
                    files.decls_of(target).into_vec(),
                    source.declarations.clone(),
                );
                LateBoundConflict::NotMerged(early, late, target_flags | source_flags)
            };
            if is_excluded(target_flags) {
                conflicts.push(match target_flags.contains(SymFlags::NAMESPACE_MODULE) {
                    true => LateBoundConflict::NonModuleEntity(source.declarations[0], target),
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
                    let merged = &mut late[index];
                    merged.is_late = false;
                    merged.flags |= target_flags;
                    merged.declarations.splice(0..0, files.decls_of(target));
                    let target_value_declaration = files.value_declaration(target);
                    let source_value_declaration =
                        std::mem::replace(&mut merged.value_declaration, target_value_declaration);
                    if let Some(node) = source_value_declaration {
                        set_value_declaration(&mut merged.value_declaration, node);
                    }
                }
                AliasTarget::Symbol(resolved) if !is_excluded(files.flags(resolved)) => {
                    late[index].is_late = false;
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
        // This table replaces the one from a call that started over, but keeps the conflicts that call reported.
        if let Some(Some(replaced)) = self.late_bound_members.get(side) {
            conflicts.extend(replaced.conflicts.iter().cloned());
        }
        let is_empty = late.is_empty() && bound_by_another_call.is_empty();
        let late: LateBoundMembers = (!is_empty).then(|| {
            let symbol_of = late
                .iter()
                .zip(0..)
                .flat_map(|(symbol, index)| {
                    let declarations = symbol.declarations.iter();
                    declarations.map(move |&declaration| (declaration, index))
                })
                .chain(unlisted)
                .collect();
            std::rc::Rc::new(LateBoundSymbols {
                symbols: late,
                symbol_of,
                replaced_aliases,
                bound_by_another_call,
                conflicts,
            })
        });
        self.late_bound_members.insert(side, late.clone());
        late
    }
}
