//! What is derived from the binder's tables the first time a rule asks about references or scopes.

use super::{RawReference, ReferenceFlags, ReferenceSite, Scope, ScopeKind, Symbol};
use crate::ast::{Expr, ExprKind, File, Node, UnOp};
use bun_sema::bind::{self, ScopeId, SymbolId};
use bun_sema::hir;

pub(crate) struct ReferenceIndex {
    /// Sorted by symbol, then by position.
    references: Vec<RawReference>,
    /// For each symbol, its range of `references`.
    ranges: Vec<(u32, u32)>,
    unresolved: Vec<RawReference>,
    /// The symbols that are declared in a scope.
    symbols: Vec<SymbolId>,
    /// For each scope, its range of `symbols_by_scope`.
    scope_symbols: Vec<(u32, u32)>,
    symbols_by_scope: Vec<SymbolId>,
    scope_of_symbol: Vec<ScopeId>,
    /// For each scope, its range of `children`.
    scope_children: Vec<(u32, u32)>,
    children: Vec<ScopeId>,
}

/// Whether `e`, an identifier, is read, written, or both.
fn access_of(e: Expr) -> ReferenceFlags {
    let mut at = e;
    loop {
        let Node::Expr(parent) = at.parent() else {
            return match at.parent() {
                // `for (a in b)`, `for (a of b)`
                Node::Stmt(s) if matches!(s.parent(), Node::Stmt(outer) if matches!(outer.kind(),
                    crate::ast::StmtKind::ForIn { left, .. } | crate::ast::StmtKind::ForOf { left, .. } if left == s)) =>
                {
                    ReferenceFlags::WRITE
                }
                // `({ a: b } = c)`, `({ a } = c)`
                Node::Prop(prop) => match prop.parent() {
                    Node::Expr(object) if prop.value() == Some(at) => {
                        at = object;
                        continue;
                    }
                    _ => ReferenceFlags::READ,
                },
                _ => ReferenceFlags::READ,
            };
        };
        return match parent.kind() {
            ExprKind::Assign { op: None, target, .. } if target == at => ReferenceFlags::WRITE,
            ExprKind::Assign { target, .. } if target == at => ReferenceFlags::READ | ReferenceFlags::WRITE,
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => ReferenceFlags::READ | ReferenceFlags::WRITE,
            // Part of a destructuring target, if what contains it is one.
            ExprKind::Array(_) | ExprKind::Spread(_) => {
                at = parent;
                continue;
            }
            _ if at != e => ReferenceFlags::READ,
            _ => ReferenceFlags::READ,
        };
    }
}

/// `ranges[key]` for items that are sorted by key.
fn ranges_by<T>(items: &[T], count: usize, key: impl Fn(&T) -> usize) -> Vec<(u32, u32)> {
    let mut ranges = vec![(0u32, 0u32); count];
    for (i, item) in items.iter().enumerate() {
        if let Some(range) = ranges.get_mut(key(item)) {
            if range.1 == 0 {
                range.0 = i as u32;
            }
            range.1 += 1;
        }
    }
    ranges
}

fn slice<'t, T>(items: &'t [T], range: Option<&(u32, u32)>) -> &'t [T] {
    let &(start, len) = range.unwrap_or(&(0, 0));
    items.get(start as usize..(start + len) as usize).unwrap_or_default()
}

impl ReferenceIndex {
    pub(crate) fn new(file: &File) -> ReferenceIndex {
        let (hir, bound) = (&file.hir, &file.bound);
        let symbol_count = file.binding.symbol_count();
        let mut references = Vec::new();
        let mut unresolved = Vec::new();
        for (i, e) in hir.exprs.iter().enumerate() {
            if !matches!(e.kind, hir::ExprKind::Ident(_))
                || matches!(bound.expr_parent.get(i), None | Some(bind::Parent::None))
            {
                continue;
            }
            let id = hir::ExprId(i as u32);
            let symbol = bound.expr_symbol.get(i).copied().unwrap_or(SymbolId::NONE);
            let raw = RawReference {
                site: ReferenceSite::Expr(id),
                symbol,
                flags: ReferenceFlags::READ,
            };
            match symbol.is_some() {
                true => references.push(raw),
                false => unresolved.push(raw),
            }
        }
        let position = |raw: &RawReference| match raw.site {
            ReferenceSite::Expr(e) => hir.exprs[e.idx()].pos,
            ReferenceSite::Pat(p) => hir.pats[p.idx()].pos,
            ReferenceSite::Name(n) => hir.names[n.idx()].pos(),
            ReferenceSite::ExportSpec(s) => hir.export_specs[s.idx()].local_pos,
        };
        references.sort_by_key(|raw| (raw.symbol.0, position(raw)));
        unresolved.sort_by_key(position);
        let ranges = ranges_by(&references, symbol_count, |raw| raw.symbol.idx());

        let mut by_scope: Vec<(ScopeId, SymbolId)> = Vec::new();
        for (i, scope) in bound.scopes.iter().enumerate() {
            for &(_, symbol) in file.binding.table(scope.locals) {
                by_scope.push((ScopeId(i as u32), symbol));
            }
        }
        let mut scope_of_symbol = vec![ScopeId::NONE; symbol_count];
        for &(scope, symbol) in &by_scope {
            if let Some(slot) = scope_of_symbol.get_mut(symbol.idx()) {
                *slot = scope;
            }
        }
        let scope_symbols = ranges_by(&by_scope, bound.scopes.len(), |it| it.0.idx());
        let symbols_by_scope: Vec<SymbolId> = by_scope.iter().map(|it| it.1).collect();

        let mut children: Vec<(ScopeId, ScopeId)> = Vec::new();
        for i in 1..bound.scopes.len() {
            let id = ScopeId(i as u32);
            if declares(bound.scopes[i].kind)
                && let Some(parent) = parent_of_scope(file, id)
            {
                children.push((parent, id));
            }
        }
        children.sort_by_key(|it| (it.0.0, it.1.0));
        let scope_children = ranges_by(&children, bound.scopes.len(), |it| it.0.idx());

        ReferenceIndex {
            references,
            ranges,
            unresolved,
            symbols: symbols_by_scope.clone(),
            scope_symbols,
            symbols_by_scope,
            scope_of_symbol,
            scope_children,
            children: children.into_iter().map(|it| it.1).collect(),
        }
    }

    #[inline]
    pub(crate) fn of(&self, symbol: SymbolId) -> &[RawReference] {
        slice(&self.references, self.ranges.get(symbol.idx()))
    }

    #[inline]
    pub(crate) fn unresolved(&self) -> &[RawReference] {
        &self.unresolved
    }

    #[inline]
    pub(crate) fn all_symbols(&self) -> &[SymbolId] {
        &self.symbols
    }

    pub(crate) fn scope_of_symbol<'a>(&self, file: &'a File<'a>, symbol: SymbolId) -> Scope<'a> {
        let scope = self.scope_of_symbol.get(symbol.idx()).copied();
        Scope::new(file, scope.filter(|it| it.is_some()).unwrap_or(ScopeId(0)))
    }

    pub(crate) fn is_exported(&self, _symbol: SymbolId) -> bool {
        false
    }

    pub(crate) fn node_of<'a>(&self, file: &'a File<'a>, site: ReferenceSite) -> Node<'a> {
        match site {
            ReferenceSite::Expr(e) => Node::Expr(Expr::new(file, e)),
            ReferenceSite::Pat(p) => Node::Pat(crate::ast::Pat::new(file, p)),
            ReferenceSite::ExportSpec(s) => Node::ExportSpec(crate::ast::ExportSpec::new(file, s)),
            ReferenceSite::Name(_) => Node::File(file),
        }
    }

    pub(crate) fn write_expr<'a>(&self, file: &'a File<'a>, raw: RawReference) -> Option<Expr<'a>> {
        let ReferenceSite::Expr(e) = raw.site else {
            return None;
        };
        match Expr::new(file, e).parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, value, .. } if target.id() == e => Some(value),
                _ => None,
            },
            _ => None,
        }
    }

    #[inline]
    pub(crate) fn children_of_scope(&self, scope: ScopeId) -> &[ScopeId] {
        slice(&self.children, self.scope_children.get(scope.idx()))
    }

    #[inline]
    pub(crate) fn symbols_of_scope(&self, scope: ScopeId) -> &[SymbolId] {
        slice(&self.symbols_by_scope, self.scope_symbols.get(scope.idx()))
    }

    pub(crate) fn references_in_scope(&self, _scope: ScopeId) -> &[RawReference] {
        &[]
    }

    pub(crate) fn node_of_scope<'a>(&self, file: &'a File<'a>, scope: ScopeId) -> Node<'a> {
        use bind::ScopeKind as K;
        match file.bound.scopes.get(scope.idx()).map(|it| it.kind) {
            Some(K::Fn(f)) => Node::Func(crate::ast::Func::new(file, f)),
            Some(K::Class(c)) => Node::Class(crate::ast::Class::new(file, c)),
            _ => Node::File(file),
        }
    }

    pub(crate) fn at_expr(&self, file: &File, e: hir::ExprId) -> Option<RawReference> {
        let _ = (file, access_of as fn(Expr) -> ReferenceFlags);
        let symbol = *file.bound.expr_symbol.get(e.idx())?;
        let among = match symbol.is_some() {
            true => self.of(symbol),
            false => &self.unresolved,
        };
        among.iter().find(|raw| raw.site == ReferenceSite::Expr(e)).copied()
    }

    pub(crate) fn scope_of_node<'a>(&self, node: Node<'a>) -> Scope<'a> {
        let file = node.file();
        for at in std::iter::once(node).chain(node.ancestors()) {
            let scope = match at {
                Node::Func(f) => f.scope().map(Scope::id),
                Node::Stmt(s) => file.bound.stmt_scope.get(s.id().idx()).copied(),
                Node::Class(c) => file.bound.class_scope.get(c.id().idx()).copied(),
                _ => None,
            };
            if let Some(scope) = scope.filter(|it| it.is_some()) {
                return Scope::new(file, nearest_declaring(file, scope));
            }
        }
        Scope::new(file, ScopeId(0))
    }
}

/// Whether a scope of this kind can declare anything. The others only mark a part of the scope
/// around them for the type checker.
fn declares(kind: bind::ScopeKind) -> bool {
    use bind::ScopeKind as K;
    matches!(
        kind,
        K::File
            | K::Module(_)
            | K::Fn(_)
            | K::Block
            | K::Class(_)
            | K::Interface(_)
            | K::TypeAlias(_)
            | K::TypeParams
            | K::Enum(_)
            | K::InferConstraint
    )
}

fn nearest_declaring(file: &File, mut scope: ScopeId) -> ScopeId {
    while let Some(it) = file.bound.scopes.get(scope.idx()) {
        if declares(it.kind) || it.parent.is_none() {
            break;
        }
        scope = it.parent;
    }
    scope
}

pub(super) fn parent_of_scope(file: &File, scope: ScopeId) -> Option<ScopeId> {
    let parent = file.bound.scopes.get(scope.idx())?.parent;
    parent.is_some().then(|| nearest_declaring(file, parent))
}

pub(super) fn kind_of_scope(file: &File, scope: ScopeId) -> ScopeKind {
    use bind::ScopeKind as K;
    match file.bound.scopes.get(scope.idx()).map(|it| it.kind) {
        Some(K::File) | None => match file.is_module() {
            true => ScopeKind::Module,
            false => ScopeKind::Global,
        },
        Some(K::Module(_)) => ScopeKind::TsModule,
        Some(K::Fn(_)) => ScopeKind::Function,
        Some(K::Class(_)) => ScopeKind::Class,
        Some(K::Enum(_)) => ScopeKind::TsEnum,
        Some(K::Interface(_) | K::TypeAlias(_) | K::TypeParams | K::InferConstraint) => ScopeKind::Type,
        Some(_) => ScopeKind::Block,
    }
}

pub(super) fn is_strict_scope(file: &File, _scope: ScopeId) -> bool {
    file.is_module()
}

pub(super) fn declared_symbols<'a>(_node: Node<'a>) -> Vec<Symbol<'a>> {
    Vec::new()
}
