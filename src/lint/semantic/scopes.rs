//! The scopes of a file, as ESLint has them.
//!
//! A scope is a range of the source text, so the tree follows from the positions of the nodes that
//! create scopes: one pass over the vectors of the HIR that hold such nodes, a sort by position,
//! and a sweep with a stack. Scopes are numbered in the order they start, which makes the scopes
//! inside a scope a contiguous range of numbers.

use super::ScopeKind;
use crate::ast::File;
use crate::language::{Parser, SourceType};
use bun_sema::bind::{ClassOwner, FnOwner, MemberOwner, Parent};
use bun_sema::hir::{self, FnKind, StmtKind, TypeNodeKind, VarKind};

pub(crate) const NONE: u32 = u32::MAX;

/// The node that creates a scope: ESLint's `scope.block`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Block {
    File,
    Stmt(hir::StmtId),
    Fn(hir::FnId),
    Class(hir::ClassId),
    /// The initializer of a class field.
    Expr(hir::ExprId),
    Type(hir::TypeNodeId),
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct ScopeData {
    pub(crate) kind: ScopeKind,
    pub(crate) is_strict: bool,
    pub(crate) block: Block,
    pub(crate) parent: u32,
    /// The last scope inside it, or itself.
    pub(crate) last: u32,
    pub(crate) variable_scope: u32,
    /// For a function with a body, where that starts. 0 for every other scope.
    pub(crate) body_start: u32,
}

/// A range of the text in which everything belongs to one scope, except what is in a region inside
/// it.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Region {
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// The region around it. The first region is its own parent.
    parent: u32,
    /// ESLint's `reference.from` for what is written here.
    pub(crate) from: u32,
    /// ESLint's `getScope` for a node here. It differs from `from` in the parts of a node that are
    /// evaluated outside the scope that the node creates: the discriminant of a `switch`, the
    /// object of a `with`, the decorators of a class, the false branch of a conditional type.
    pub(crate) get: u32,
    /// It is the range of the scope `from`.
    is_scope: bool,
}

pub(crate) struct ScopeTree {
    pub(crate) scopes: Vec<ScopeData>,
    /// Sorted by start. A region comes after the regions that contain it.
    regions: Vec<Region>,
    /// By `FnId`.
    pub(crate) of_fn: Vec<u32>,
    /// By `ClassId`.
    pub(crate) of_class: Vec<u32>,
}

#[derive(Copy, Clone)]
enum What {
    Scope(ScopeKind, Block, u32),
    /// A part of the node that creates the scope at this index of the list, outside that scope.
    Outside(u32),
    /// A part of a scope that is evaluated in the scope around that one.
    Lifted,
}

#[derive(Copy, Clone)]
struct Proto {
    start: u32,
    end: u32,
    /// Among ranges that are equal, the lower contains the higher.
    rank: u8,
    what: What,
}

/// Whether the file is analyzed as `eslint-scope` does it. Otherwise as
/// `@typescript-eslint/scope-manager` does.
#[inline]
pub(crate) fn is_javascript_mode(file: &File) -> bool {
    file.is_javascript() && file.language().parser != Parser::TypeScript
}

/// ESLint's `scopeManager.isGlobalReturn()`.
#[inline]
pub(crate) fn has_top_level_function(file: &File) -> bool {
    file.language().has_function_scope_at_top_level()
}

/// What kind of scope a function creates.
pub(crate) fn kind_of_function(file: &File, f: usize) -> Option<ScopeKind> {
    let is_signature = || {
        matches!(file.bound.fns.get(f).map(|it| it.owner), Some(FnOwner::Member(m))
            if matches!(
                file.bound.member_owner.get(m.idx()),
                Some(MemberOwner::Interface(_) | MemberOwner::TypeLiteral(_))
            ))
    };
    Some(match file.hir.fns.get(f)?.kind {
        FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Constructor => ScopeKind::Function,
        FnKind::Method | FnKind::Getter | FnKind::Setter => match is_signature() {
            true => ScopeKind::FunctionType,
            false => ScopeKind::Function,
        },
        FnKind::StaticBlock => ScopeKind::ClassStaticBlock,
        FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType => ScopeKind::FunctionType,
        FnKind::IndexSignature => return None,
    })
}

/// The statements start with a `"use strict"` directive.
fn has_use_strict(file: &File, statements: impl Iterator<Item = hir::StmtId>) -> bool {
    let hir = &file.hir;
    for s in statements {
        let Some(hir::Stmt {
            kind: StmtKind::Expr(e),
            ..
        }) = hir.stmts.get(s.idx())
        else {
            return false;
        };
        let Some(hir::Expr {
            kind: hir::ExprKind::String(_),
            pos,
            end,
        }) = hir.exprs.get(e.idx())
        else {
            return false;
        };
        let written = hir.text.get(*pos as usize..*end as usize).unwrap_or_default();
        // A template, or a string in parentheses, is no directive.
        if !matches!(written.first(), Some(b'"' | b'\''))
            || hir.parens.binary_search_by_key(&e.0, |it| it.0.0).is_ok()
        {
            return false;
        }
        if written.get(1..written.len() - 1) == Some(b"use strict") {
            return true;
        }
    }
    false
}

impl ScopeTree {
    pub(crate) fn new<'a>(file: &'a File<'a>) -> ScopeTree {
        let protos = collect(file);
        let mut order: Vec<u32> = (0..protos.len() as u32).collect();
        order.sort_unstable_by_key(|&i| {
            let it = &protos[i as usize];
            (it.start, u32::MAX - it.end, it.rank, i)
        });

        let language = file.language();
        let supports_strict = !is_javascript_mode(file) || language.ecma_version >= 5;
        let mut tree = ScopeTree {
            scopes: Vec::with_capacity(protos.len()),
            regions: Vec::with_capacity(protos.len()),
            of_fn: vec![NONE; file.hir.fns.len()],
            of_class: vec![NONE; file.hir.classes.len()],
        };
        let mut scope_of_proto = vec![NONE; protos.len()];
        let mut outside: Vec<(u32, u32)> = Vec::new();
        let mut stack: Vec<u32> = Vec::new();
        for &index in &order {
            let proto = protos[index as usize];
            while let Some(&top) = stack.last()
                && tree.regions[top as usize].end <= proto.start
            {
                tree.leave(top);
                stack.pop();
            }
            let around = stack.last().copied();
            let region = tree.regions.len() as u32;
            // After a syntax error ranges can overlap.
            let end = around.map_or(proto.end, |it| proto.end.min(tree.regions[it as usize].end));
            let outer = around.map_or(NONE, |it| tree.regions[it as usize].from);
            let (from, get) = match proto.what {
                What::Outside(owner) => {
                    outside.push((region, owner));
                    (outer, outer)
                }
                What::Lifted => match tree.scopes.get(outer as usize) {
                    Some(it) if it.parent != NONE => (it.parent, outer),
                    _ => (outer, outer),
                },
                What::Scope(kind, block, body_start) => {
                    let id = tree.scopes.len() as u32;
                    scope_of_proto[index as usize] = id;
                    match block {
                        Block::Fn(f) if kind != ScopeKind::FunctionExpressionName => {
                            tree.of_fn[f.idx()] = id;
                        }
                        Block::Class(c) => tree.of_class[c.idx()] = id,
                        _ => {}
                    }
                    let parent = tree.scopes.get(outer as usize).copied();
                    let is_variable_scope = matches!(
                        kind,
                        ScopeKind::Global
                            | ScopeKind::Module
                            | ScopeKind::Function
                            | ScopeKind::ClassFieldInitializer
                            | ScopeKind::ClassStaticBlock
                            | ScopeKind::TsModule
                    );
                    tree.scopes.push(ScopeData {
                        kind,
                        is_strict: supports_strict && tree.is_strict(file, kind, block, parent),
                        block,
                        parent: outer,
                        last: id,
                        variable_scope: match (is_variable_scope, parent) {
                            (false, Some(parent)) => parent.variable_scope,
                            _ => id,
                        },
                        body_start,
                    });
                    (id, id)
                }
            };
            tree.regions.push(Region {
                start: proto.start,
                end,
                parent: around.unwrap_or(region),
                from,
                get,
                is_scope: matches!(proto.what, What::Scope(..)),
            });
            stack.push(region);
        }
        while let Some(top) = stack.pop() {
            tree.leave(top);
        }
        for (region, owner) in outside {
            tree.regions[region as usize].get = scope_of_proto[owner as usize];
        }
        // ESLint's `Referencer.Program`
        if is_javascript_mode(file)
            && language.implied_strict
            && supports_strict
            && let Some(innermost) = tree.scopes.iter().rposition(|it| it.block == Block::File)
        {
            for scope in &mut tree.scopes[innermost..] {
                scope.is_strict = true;
            }
        }
        tree
    }

    /// Everything in the region has been numbered.
    fn leave(&mut self, region: u32) {
        let region = self.regions[region as usize];
        if region.is_scope {
            let last = self.scopes.len() as u32 - 1;
            self.scopes[region.from as usize].last = last;
        }
    }

    /// ESLint's `isStrictScope`.
    fn is_strict<'a>(
        &self,
        file: &'a File<'a>,
        kind: ScopeKind,
        block: Block,
        parent: Option<ScopeData>,
    ) -> bool {
        let top_level = || file.body().iter().map(|it| it.id());
        if parent.is_some_and(|it| it.is_strict) {
            return true;
        }
        match (kind, block) {
            (
                ScopeKind::Class
                | ScopeKind::Module
                | ScopeKind::ConditionalType
                | ScopeKind::FunctionType
                | ScopeKind::MappedType
                | ScopeKind::TsEnum
                | ScopeKind::TsModule
                | ScopeKind::Type,
                _,
            ) => true,
            // "Force strictness of GlobalScope to false when using node.js scope."
            (ScopeKind::Global, _) => !has_top_level_function(file) && has_use_strict(file, top_level()),
            (ScopeKind::Function, Block::File) => has_use_strict(file, top_level()),
            (ScopeKind::Function, Block::Fn(f)) => match file.hir.fns.get(f.idx()).map(|it| it.body) {
                Some(hir::FnBody::Block(statements)) => {
                    let ids = file.hir.ids.get(statements.range()).unwrap_or_default();
                    has_use_strict(file, ids.iter().map(|&it| hir::StmtId(it)))
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// The innermost region that contains `pos`.
    pub(crate) fn region_at(&self, pos: u32) -> &Region {
        let after = self.regions.partition_point(|it| it.start <= pos);
        let mut at = after.saturating_sub(1);
        while self.regions[at].end <= pos && self.regions[at].parent as usize != at {
            at = self.regions[at].parent as usize;
        }
        &self.regions[at]
    }

    /// ESLint's `getScope` for a node with this range. `block`: the node, if a node of its sort
    /// can create a scope.
    pub(crate) fn scope_of_node(&self, start: u32, end: u32, block: Option<Block>) -> u32 {
        let after = self.regions.partition_point(|it| it.start <= start);
        let mut at = after.saturating_sub(1);
        loop {
            let region = &self.regions[at];
            if block.is_some() && self.scopes.get(region.get as usize).map(|it| it.block) == block {
                return region.get;
            }
            // What has the range of the node is created by something in the node.
            let is_around = end.max(start + 1) <= region.end && (region.start, region.end) != (start, end);
            if is_around || region.parent as usize == at {
                return region.get;
            }
            at = region.parent as usize;
        }
    }

    /// Finds the regions of positions that do not decrease.
    pub(crate) fn cursor(&self) -> Cursor<'_> {
        Cursor {
            regions: &self.regions,
            next: 1,
            at: 0,
        }
    }

    /// Whether `inner` is `outer` or inside it.
    #[inline]
    pub(crate) fn contains(&self, outer: u32, inner: u32) -> bool {
        outer <= inner && self.scopes.get(outer as usize).is_some_and(|it| inner <= it.last)
    }
}

pub(crate) struct Cursor<'t> {
    regions: &'t [Region],
    next: usize,
    at: usize,
}

impl Cursor<'_> {
    /// The innermost region that contains `pos`, which is not less than in the call before.
    #[inline]
    pub(crate) fn seek(&mut self, pos: u32) -> &Region {
        while self.regions[self.at].end <= pos && self.at != 0 {
            self.at = self.regions[self.at].parent as usize;
        }
        while let Some(region) = self.regions.get(self.next)
            && region.start <= pos
        {
            if pos < region.end {
                self.at = self.next;
            }
            self.next += 1;
        }
        &self.regions[self.at]
    }
}

/// Every scope of the file, and the parts of the nodes that create them that are outside them, in
/// no particular order.
fn collect(file: &File) -> Vec<Proto> {
    let (hir, bound) = (&file.hir, &file.bound);
    let is_javascript = is_javascript_mode(file);
    // Before ES2015 only functions, `catch` and `with` create scopes.
    let has_block_scopes = !is_javascript || file.language().ecma_version >= 2015;
    let is_synthetic = |pos: u32| file.has_synthetic_nodes() && file.is_in_jsdoc(pos);
    let mut protos: Vec<Proto> = Vec::with_capacity(hir.fns.len() * 2 + hir.classes.len() + 8);
    let scope = |kind: ScopeKind, block: Block, start: u32, end: u32| Proto {
        start,
        end,
        rank: match kind {
            ScopeKind::Global => 0,
            ScopeKind::Module => 1,
            ScopeKind::Function if block == Block::File => 1,
            ScopeKind::With => 2,
            ScopeKind::ClassFieldInitializer => 3,
            ScopeKind::FunctionExpressionName => 4,
            _ => 5,
        },
        what: What::Scope(kind, block, 0),
    };
    /// Adds the scope, and `[start, inside)` as a part of its node that is outside it.
    macro_rules! scope_from {
        ($kind:expr, $block:expr, $start:expr, $inside:expr, $end:expr) => {{
            let (start, inside): (u32, u32) = ($start, $inside);
            let owner = protos.len() as u32;
            protos.push(scope($kind, $block, inside, $end));
            if start < inside {
                protos.push(Proto {
                    start,
                    end: inside,
                    rank: 2,
                    what: What::Outside(owner),
                });
            }
        }};
    }

    protos.push(scope(ScopeKind::Global, Block::File, 0, u32::MAX));
    if has_top_level_function(file) {
        protos.push(scope(ScopeKind::Function, Block::File, 0, u32::MAX));
    }
    if file.language().scope_source_type() == SourceType::Module && has_block_scopes {
        protos.push(scope(ScopeKind::Module, Block::File, 0, u32::MAX));
    }

    for (i, stmt) in hir.stmts.iter().enumerate() {
        let declares_lexically = |head: hir::StmtId| {
            matches!(hir.stmts.get(head.idx()).map(|it| it.kind), Some(StmtKind::Var(decls))
                if hir.var_decls.get(decls.start as usize).is_some_and(|it| it.kind != VarKind::Var))
        };
        let is_scope = matches!(
            stmt.kind,
            StmtKind::Block(_)
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::Switch { .. }
                | StmtKind::Try { .. }
        );
        if !is_scope || matches!(bound.stmt_parent.get(i), None | Some(Parent::None)) {
            continue;
        }
        let (block, start, end) = (Block::Stmt(hir::StmtId(i as u32)), stmt.start, stmt.loc.end);
        match stmt.kind {
            StmtKind::Block(parts) if is_with_statement(file, stmt) => {
                let object = hir.ids.get(parts.start as usize).and_then(|&it| hir.stmts.get(it as usize));
                let inside = object.map_or(start, |it| it.loc.end);
                scope_from!(ScopeKind::With, block, start, inside, end);
            }
            StmtKind::Block(_) if has_block_scopes => protos.push(scope(ScopeKind::Block, block, start, end)),
            StmtKind::For { init: head, .. }
            | StmtKind::ForIn { left: head, .. }
            | StmtKind::ForOf { left: head, .. }
                if declares_lexically(head) =>
            {
                protos.push(scope(ScopeKind::For, block, start, end));
            }
            StmtKind::Switch { expr, .. } if has_block_scopes => {
                let inside = hir.exprs.get(expr.idx()).map_or(start, |it| it.end);
                scope_from!(ScopeKind::Switch, block, start, inside, end);
            }
            StmtKind::Try {
                block: tried,
                handler,
                ..
            } => {
                if let (Some(tried), Some(handler)) = (hir.stmts.get(tried.idx()), hir.stmts.get(handler.idx())) {
                    protos.push(scope(ScopeKind::Catch, block, tried.loc.end, handler.loc.end));
                }
            }
            _ => {}
        }
    }

    let mut body_starts = hir.body_starts.iter().peekable();
    for (i, func) in hir.fns.iter().enumerate() {
        while body_starts.next_if(|it| it.0.idx() < i).is_some() {}
        let Some(kind) = kind_of_function(file, i) else {
            continue;
        };
        if is_synthetic(func.start) || (is_javascript && kind == ScopeKind::FunctionType) {
            continue;
        }
        let (whole_start, end) = match bound.fns.get(i).map(|it| it.owner) {
            Some(FnOwner::Expr(e)) => match hir.exprs.get(e.idx()) {
                Some(e) => (e.pos, e.end),
                None => continue,
            },
            Some(FnOwner::Stmt(s)) => match hir.stmts.get(s.idx()) {
                Some(s) => (s.start, s.loc.end),
                None => continue,
            },
            Some(FnOwner::Member(m)) => match hir.members.get(m.idx()) {
                Some(m) => (m.start, m.loc.end),
                None => continue,
            },
            Some(FnOwner::Type(t)) => match hir.types.get(t.idx()) {
                Some(t) => (t.pos, t.end),
                None => continue,
            },
            Some(FnOwner::None) | None => continue,
        };
        let block = Block::Fn(hir::FnId(i as u32));
        // After the name.
        let from_params = match hir.type_params.get(func.type_params.start as usize) {
            // Not those of a `@template` tag.
            Some(first) if !func.type_params.is_empty() && !is_synthetic(first.start) => first.start,
            _ => func.anchor,
        };
        let owner = protos.len() as u32;
        match func.kind {
            FnKind::StaticBlock
            | FnKind::Arrow
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType => protos.push(scope(kind, block, whole_start, end)),
            FnKind::Expr if func.name.is_some() => {
                protos.push(scope(kind, block, from_params, end));
                protos.push(scope(ScopeKind::FunctionExpressionName, block, whole_start, end));
            }
            // The block of a method signature is the member.
            _ if kind == ScopeKind::FunctionType => scope_from!(kind, block, whole_start, from_params, end),
            _ => protos.push(scope(kind, block, from_params, end)),
        }
        let body_start = match func.body {
            hir::FnBody::None => 0,
            hir::FnBody::Expr(e) => hir.exprs.get(e.idx()).map_or(0, |it| it.pos),
            hir::FnBody::Block(_) => match body_starts.peek() {
                Some(it) if it.0.idx() == i => it.1,
                _ => func.anchor,
            },
        };
        if kind == ScopeKind::Function
            && let What::Scope(_, _, slot) = &mut protos[owner as usize].what
        {
            *slot = body_start;
        }
        // The decorators of the parameters of a method are evaluated in the scope of the class.
        if !hir.modifiers_of_params.is_empty()
            && matches!(bound.fns.get(i).map(|it| it.owner), Some(FnOwner::Member(_)))
            && !matches!(func.body, hir::FnBody::None)
        {
            for p in func.params.iter() {
                let modifiers = hir.modifiers_of_params.get(p.idx()).copied().unwrap_or_default();
                let decorators_end = hir.modifiers.get(modifiers.range()).unwrap_or_default().iter();
                let decorators_end = decorators_end
                    .filter_map(|it| match it.kind {
                        hir::ModifierKind::Decorator(e) => hir.exprs.get(e.idx()).map(|e| e.end),
                        hir::ModifierKind::Keyword(_) => None,
                    })
                    .max();
                if let (Some(end), Some(param)) = (decorators_end, hir.params.get(p.idx())) {
                    protos.push(Proto {
                        start: param.pos,
                        end,
                        rank: 5,
                        what: What::Lifted,
                    });
                }
            }
        }
    }

    for (i, class) in hir.classes.iter().enumerate() {
        let end = match bound.class_owner.get(i) {
            Some(&ClassOwner::Expr(e)) => hir.exprs.get(e.idx()).map(|it| it.end),
            Some(&ClassOwner::Stmt(s)) => hir.stmts.get(s.idx()).map(|it| it.loc.end),
            None => None,
        };
        let is_reached = bound.class_scope.get(i).is_some_and(|it| it.is_some());
        let (Some(end), true) = (end, is_reached) else {
            continue;
        };
        // After the name, or else after the modifiers.
        let inside = match class.name.is_some() {
            true => class.name_pos + 1,
            false => {
                let modifiers = hir.modifiers.get(class.modifiers.range()).unwrap_or_default();
                let ends = modifiers.iter().map(|it| match it.kind {
                    hir::ModifierKind::Decorator(e) => hir.exprs.get(e.idx()).map_or(it.pos, |e| e.end),
                    hir::ModifierKind::Keyword(_) => it.pos + 1,
                });
                ends.max().unwrap_or(class.start).max(class.start)
            }
        };
        scope_from!(
            ScopeKind::Class,
            Block::Class(hir::ClassId(i as u32)),
            class.start,
            inside,
            end
        );
    }

    for (i, member) in hir.members.iter().enumerate() {
        if member.init.is_some()
            && member.kind == hir::MemberKind::Property
            && matches!(bound.member_owner.get(i), Some(MemberOwner::Class(_)))
            && let Some(init) = hir.exprs.get(member.init.idx())
        {
            let block = Block::Expr(member.init);
            // The HIR positions a class expression after its decorators.
            let start = match init.kind {
                hir::ExprKind::Class(c) => hir.classes.get(c.idx()).map_or(init.pos, |it| it.start.min(init.pos)),
                _ => init.pos,
            };
            protos.push(scope(ScopeKind::ClassFieldInitializer, block, start, init.end));
        }
    }

    if is_javascript {
        return protos;
    }

    for (i, ty) in hir.types.iter().enumerate() {
        if !matches!(ty.kind, TypeNodeKind::Cond { .. } | TypeNodeKind::Mapped(_))
            || bound.type_scope.get(i).is_none_or(|it| it.is_none())
            || is_synthetic(ty.pos)
        {
            continue;
        }
        let block = Block::Type(hir::TypeNodeId(i as u32));
        match ty.kind {
            TypeNodeKind::Cond { yes, .. } => {
                let inside_end = hir.types.get(yes.idx()).map_or(ty.end, |it| it.end).min(ty.end);
                let owner = protos.len() as u32;
                protos.push(scope(ScopeKind::ConditionalType, block, ty.pos, inside_end));
                protos.push(Proto {
                    start: inside_end,
                    end: ty.end,
                    rank: 2,
                    what: What::Outside(owner),
                });
            }
            _ => protos.push(scope(ScopeKind::MappedType, block, ty.pos, ty.end)),
        }
    }
    let mut declaration = |kind: ScopeKind, s: hir::StmtId, name_pos: u32| {
        if let Some(stmt) = hir.stmts.get(s.idx())
            && !matches!(bound.stmt_parent.get(s.idx()), None | Some(Parent::None))
            && !is_synthetic(name_pos)
        {
            scope_from!(kind, Block::Stmt(s), stmt.start, name_pos + 1, stmt.loc.end);
        }
    };
    for it in hir.interfaces.iter().filter(|it| !it.type_params.is_empty()) {
        declaration(ScopeKind::Type, it.stmt, it.name_pos);
    }
    for it in hir.aliases.iter().filter(|it| !it.type_params.is_empty()) {
        declaration(ScopeKind::Type, it.stmt, it.name_pos);
    }
    for it in hir.enums {
        declaration(ScopeKind::TsEnum, it.stmt, it.name_pos);
    }
    for it in hir.modules {
        // `namespace A.B.C { }` is one declaration, which the HIR stores as three.
        if !is_after_dot(file, it) {
            declaration(ScopeKind::TsModule, it.stmt, last_name_pos(file, it));
        }
    }
    protos
}

/// `with (object) body`, which the HIR stores as a block of the two.
pub(crate) fn is_with_statement(file: &File, stmt: &hir::Stmt) -> bool {
    !file.hir.with_bodies.is_empty()
        && matches!(stmt.kind, StmtKind::Block(parts) if parts.len() == 2)
        && file.hir.text.get(stmt.start as usize..).is_some_and(|it| it.starts_with(b"with"))
}

/// Whether `module` is the `B` of `namespace A.B`.
pub(crate) fn is_after_dot(file: &File, module: &hir::Module) -> bool {
    file.hir.stmts.get(module.stmt.idx()).is_some_and(|it| it.start == module.name_pos)
        && matches!(module.name, hir::ModuleName::Ident(_))
}

/// The `B` of the `A` of `namespace A.B`.
pub(crate) fn after_dot<'a>(file: &File<'a>, module: &hir::Module) -> Option<&'a hir::Module> {
    if module.body.len() != 1 {
        return None;
    }
    let only = file.hir.stmts.get(*file.hir.ids.get(module.body.start as usize)? as usize)?;
    match only.kind {
        StmtKind::Module(inner) => file.hir.modules.get(inner.idx()).filter(|it| is_after_dot(file, it)),
        _ => None,
    }
}

fn last_name_pos<'a>(file: &File<'a>, mut module: &'a hir::Module) -> u32 {
    while let Some(inner) = after_dot(file, module) {
        module = inner;
    }
    module.name_pos
}
