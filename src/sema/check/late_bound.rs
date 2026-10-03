//! The members whose names the checker works out: `getResolvedMembersOrExportsOfSymbol`, `lateBindMember`, `getLateBoundSymbol`.

use super::*;
use crate::bind::{Decl, flags_of_member, flags_of_property};
use crate::program::get_excluded_symbol_flags;

/// What `lateBindMember` and `combineSymbolTables` report.
pub(super) enum LateBoundConflict {
    /// `lateBindMember`: the name, the declarations of the symbols that have it, early and late, and the one they refuse.
    Refused(Atom, Vec<(FileId, Decl)>, (FileId, Decl)),
    /// `reportMergeSymbolError`: the declarations of the early bound symbol, and those of the late bound one.
    NotMerged(Vec<(FileId, Decl)>, Vec<(FileId, Decl)>),
}

/// The symbols with `CheckFlagsLate` of one side of a container, after `combineSymbolTables`.
pub(super) struct LateBoundSymbols {
    /// `symbol.Declarations` of each: those of the early bound symbol of that name come first, if the two go together.
    declarations: Vec<Vec<(FileId, Decl)>>,
    /// Which of them a declaration is a declaration of.
    symbol_of: FxHashMap<(FileId, Decl), u32>,
    pub(super) conflicts: Vec<LateBoundConflict>,
}

/// `None`: the container has no late-bound member on that side.
pub(super) type LateBoundMembers = Option<Arc<LateBoundSymbols>>;

impl<'p> Checker<'p> {
    /// `getSymbolOfDeclaration(declaration).Declarations`
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
        if parent.is_some()
            && let Some(late) = self.late_bound_members(files.sym(file, parent), is_static)
            && let Some(&symbol) = late.symbol_of.get(&(file, declaration))
        {
            return List::Own(late.declarations[symbol as usize].clone());
        }
        files.decls_of(files.sym(file, symbol))
    }

    /// `getResolvedMembersOrExportsOfSymbol`, as far as it adds to what the binder has.
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
        // `checkObjectLiteral` takes the exports as the binder left them.
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
                    let flags = SymFlags::PROPERTY | SymFlags::ASSIGNMENT;
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
        let mut conflicts = Vec::new();
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
            late[index].0 |= flags;
            late[index].1.push((file, declaration));
        }
        // `combineSymbolTables`
        for (name, index) in late_symbols {
            let Some(early) = early_symbol(name) else {
                continue;
            };
            let (target, source) = (files.flags(early), late[index].0);
            if target.intersects(get_excluded_symbol_flags(source))
                && !(source | target).contains(SymFlags::ASSIGNMENT)
            {
                let (early, late) = (files.decls(early), late[index].1.clone());
                conflicts.push(LateBoundConflict::NotMerged(early, late));
            } else {
                late[index].1.splice(0..0, files.decls(early));
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
                conflicts,
            })
        });
        self.late_bound_members
            .insert((container, is_static), late.clone());
        late
    }
}
