//! The members whose names the checker works out: `getResolvedMembersOrExportsOfSymbol`, `lateBindMember`, `getLateBoundSymbol`.
//! The binder has the symbols of the members it can name (`Files::declarations_of_member`).

use super::*;
use crate::bind::{
    Decl, DeclaredMember, FnOwner, MemberDeclaration, MemberOwner, ScopeKind, flags_of_member,
    flags_of_property, for_each_declared_property, member_flags,
};

/// What has `symbol.Members`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum MemberContainer {
    /// A class or an interface.
    Symbol(Sym),
    TypeLiteral(FileId, TypeNodeId),
    ObjectLiteral(FileId, ExprId),
}

/// The symbols with `CheckFlagsLate` of one side of a container, after `combineSymbolTables`.
pub(super) struct LateBoundSymbols {
    /// `symbol.Declarations` of each: those of the early bound symbol of that name come first, if the two go together.
    declarations: Vec<Vec<(FileId, MemberDeclaration)>>,
    /// Which of them a declaration is a declaration of.
    symbol_of: FxHashMap<(FileId, MemberDeclaration), u32>,
}

/// `None`: no name is worked out there.
pub(super) type LateBoundMembers = Option<Arc<LateBoundSymbols>>;

impl<'p> Checker<'p> {
    /// `getLateBoundSymbol(getMergedSymbol(declaration.Symbol)).Declarations`
    pub(super) fn declarations_of_member(
        &mut self,
        file: FileId,
        declaration: MemberDeclaration,
    ) -> List<'p, (FileId, MemberDeclaration)> {
        let late = self
            .container_of_member(file, declaration)
            .and_then(|(container, is_static)| self.late_bound_members(container, is_static));
        match late
            .as_ref()
            .and_then(|late| Some((late, *late.symbol_of.get(&(file, declaration))?)))
        {
            Some((late, symbol)) => List::Own(late.declarations[symbol as usize].clone()),
            None => self.files().declarations_of_member(file, declaration),
        }
    }

    /// `declaration.Symbol.Parent`, and whether `declaration` is in its `Exports`.
    fn container_of_member(
        &self,
        file: FileId,
        declaration: MemberDeclaration,
    ) -> Option<(MemberContainer, bool)> {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let class = |class: ClassId| files.sym(file, bound.class_symbol[class.idx()]);
        let interface = |it: InterfaceId| files.sym(file, bound.interface_symbol[it.idx()]);
        let of_member = |member: MemberId| {
            Some(match bound.member_owner[member.idx()] {
                MemberOwner::Class(it) => MemberContainer::Symbol(class(it)),
                MemberOwner::Interface(it) => MemberContainer::Symbol(interface(it)),
                MemberOwner::TypeLiteral(node) => MemberContainer::TypeLiteral(file, node),
                MemberOwner::None => return None,
            })
        };
        Some(match declaration {
            MemberDeclaration::Member(member) => (
                of_member(member)?,
                hir[member].flags.contains(Flags::STATIC),
            ),
            MemberDeclaration::Parameter(parameter) => {
                match bound.fns[bound.param_fn[parameter.idx()].idx()].owner {
                    FnOwner::Member(constructor) => (of_member(constructor)?, false),
                    _ => return None,
                }
            }
            MemberDeclaration::TypeParameter(parameter) => {
                let scope = bound.type_param_scope[parameter.idx()];
                match bound.scopes.get(scope.idx())?.kind {
                    ScopeKind::Class(it) => (MemberContainer::Symbol(class(it)), false),
                    ScopeKind::Interface(it) => (MemberContainer::Symbol(interface(it)), false),
                    _ => return None,
                }
            }
            MemberDeclaration::Assignment(assignment) => {
                let (it, is_static, _) = bound.this_property(hir, assignment)?;
                (MemberContainer::Symbol(class(it)), is_static)
            }
            MemberDeclaration::Property(property) => {
                let owner = bound.prop_owner[property.idx()];
                if owner.is_none() || !matches!(hir[owner].kind, ExprKind::Object(_)) {
                    return None;
                }
                (MemberContainer::ObjectLiteral(file, owner), false)
            }
        })
    }

    /// `getMembersOfDeclaration`, of each declaration of `container`: the file, and the members or the properties.
    fn members_of_container(
        &self,
        container: MemberContainer,
    ) -> Vec<(FileId, Result<MemberOwner, Span<PropId>>)> {
        let symbol = match container {
            MemberContainer::Symbol(symbol) => symbol,
            MemberContainer::TypeLiteral(file, node) => {
                return vec![(file, Ok(MemberOwner::TypeLiteral(node)))];
            }
            MemberContainer::ObjectLiteral(file, e) => match self.hir(file)[e].kind {
                ExprKind::Object(props) => return vec![(file, Err(props))],
                _ => return Vec::new(),
            },
        };
        let files = self.files();
        let mut all = Vec::new();
        for part in files.parts(symbol).iter() {
            let bound = self.bound(part.file);
            for &decl in &bound.symbols[part.id.idx()].decls {
                match decl {
                    Decl::Class(it) if bound.class_symbol[it.idx()] == part.id => {
                        all.push((part.file, Ok(MemberOwner::Class(it))));
                    }
                    Decl::Interface(it) if bound.interface_symbol[it.idx()] == part.id => {
                        all.push((part.file, Ok(MemberOwner::Interface(it))));
                    }
                    _ => {}
                }
            }
        }
        all
    }

    /// `getResolvedMembersOrExportsOfSymbol`, as far as it adds to what the binder has.
    fn late_bound_members(
        &mut self,
        container: MemberContainer,
        is_static: bool,
    ) -> LateBoundMembers {
        if let Some(known) = self.late_bound_members.get(&(container, is_static)) {
            return known.clone();
        }
        // "In the event we recursively resolve the members/exports of the symbol, we set the initial value of
        // resolvedMembers/resolvedExports to the early-bound members/exports of the symbol."
        self.late_bound_members.insert((container, is_static), None);
        let lists = self.members_of_container(container);
        // Those with a computed name, each with `symbol.Flags`.
        let mut computed: Vec<(FileId, MemberDeclaration, PropKey, u8)> = Vec::new();
        for &(file, list) in &lists {
            let hir = self.hir(file);
            let members = match list {
                Ok(MemberOwner::Class(it)) => hir[it].members,
                Ok(MemberOwner::Interface(it)) => hir[it].members,
                Ok(MemberOwner::TypeLiteral(node)) => match hir[node].kind {
                    TypeNodeKind::Object(members) => members,
                    _ => continue,
                },
                Ok(MemberOwner::None) => continue,
                Err(props) => {
                    for p in props.iter() {
                        if let (PropKey::Computed(_), Some(flags)) =
                            (hir[p].key, flags_of_property(hir[p].kind))
                        {
                            computed.push((
                                file,
                                MemberDeclaration::Property(p),
                                hir[p].key,
                                flags.0,
                            ));
                        }
                    }
                    continue;
                }
            };
            for m in members.iter() {
                if let (PropKey::Computed(_), Some(flags)) = (hir[m].key, flags_of_member(&hir[m]))
                    && hir[m].flags.contains(Flags::STATIC) == is_static
                {
                    computed.push((file, MemberDeclaration::Member(m), hir[m].key, flags.0));
                }
            }
        }
        // `lateBindMember`. `symbol.Flags` and `symbol.Declarations`, and which symbol `lateSymbols` has under a name.
        let mut late: Vec<(u8, Vec<(FileId, MemberDeclaration)>)> = Vec::new();
        let mut late_symbols: FxHashMap<Atom, usize> = FxHashMap::default();
        for (file, declaration, key, flags) in computed {
            // `hasLateBindableName`
            let Some(name) = self.declared_member_name(file, key) else {
                continue;
            };
            let mut index = *late_symbols.entry(name).or_insert(late.len());
            if let Some(there) = late.get_mut(index)
                && there.0 & member_flags::excluded(flags) != 0
            {
                const ACCESSOR: u8 = member_flags::ACCESSOR;
                if there.0 & ACCESSOR != 0 && there.0 & ACCESSOR != flags & ACCESSOR {
                    there.0 |= ACCESSOR;
                }
                index = late.len();
            }
            if index == late.len() {
                late.push((0, Vec::new()));
            }
            late[index].0 |= flags;
            late[index].1.push((file, declaration));
        }
        // `combineSymbolTables`: `symbol.Flags` of the early bound symbol of each of those names, and a declaration of it.
        let mut early: Vec<(u8, Option<(FileId, MemberDeclaration)>)> = vec![(0, None); late.len()];
        for &(file, list) in late.first().map_or(&[][..], |_| &lists[..]) {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let note = |(key, declaration, includes, _): DeclaredMember| {
                if let Some(declaration) = declaration
                    && key.is_static == is_static
                    && !key.is_private
                    && let Some(&index) = late_symbols.get(&key.name)
                    && !bound.is_member_in_no_table(declaration)
                    && !bound.declarations_of_member(&declaration).is_empty()
                {
                    early[index].0 |= includes;
                    early[index].1.get_or_insert((file, declaration));
                }
            };
            match list {
                Ok(owner) => bound.for_each_declared_member(hir, owner, note),
                Err(props) => for_each_declared_property(hir, props, note),
            }
        }
        for (symbol, (flags, declaration)) in late.iter_mut().zip(early) {
            if let Some((file, declaration)) = declaration
                && flags & member_flags::excluded(symbol.0) == 0
            {
                let early = self.files().declarations_of_member(file, declaration);
                symbol.1.splice(0..0, early.iter().copied());
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
                .collect();
            Arc::new(LateBoundSymbols {
                declarations,
                symbol_of,
            })
        });
        self.late_bound_members
            .insert((container, is_static), late.clone());
        late
    }
}
