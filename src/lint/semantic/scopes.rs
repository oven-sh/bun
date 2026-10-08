//! The scopes of a file, as ESLint has them.
//!
//! A scope is a range of the source text, so the tree follows from the positions of the nodes that
//! create scopes: these are listed, sorted by position, and swept with a stack. Scopes are numbered
//! in the order they start, which makes the scopes inside a scope a contiguous range of numbers.

use super::ScopeKind;
use crate::ast::File;
use crate::language::{Parser, SourceType};
use bun_sema::bind::{self, ClassOwner, FnOwner, MemberOwner, Parent, ScopeNode};
use bun_sema::hir::{self, FnKind, StmtKind, TypeNodeKind, VarKind};
use std::cell::OnceCell;

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
    /// The range of the text that it is.
    start: u32,
    end: u32,
}

/// A part of the node that creates a scope that is outside that scope: the discriminant of a
/// `switch`, the object of a `with`, the decorators of a class, the false branch of a conditional
/// type. ESLint's `getScope` for a node here is that scope all the same.
#[derive(Copy, Clone)]
struct Zone {
    start: u32,
    end: u32,
    scope: u32,
}

/// A range of the text with what ESLint's `getScope` says for a node in it, unless the node is in a
/// region inside it.
#[derive(Copy, Clone, Debug)]
struct Region {
    start: u32,
    end: u32,
    /// The region around it. The first region is its own parent.
    parent: u32,
    get: u32,
}

pub(crate) struct ScopeTree {
    pub(crate) scopes: Vec<ScopeData>,
    /// By `FnId`.
    pub(crate) of_fn: Vec<u32>,
    /// By `ClassId`.
    pub(crate) of_class: Vec<u32>,
    /// The `export as namespace N` statements.
    pub(crate) namespace_exports: Vec<hir::StmtId>,
    /// The types of the parameters of `catch` clauses, which typescript-eslint does not visit.
    pub(crate) unvisited: Vec<(u32, u32)>,
    /// Each position from which on what is written belongs to another scope, with that scope:
    /// ESLint's `reference.from`. Sorted. Of those at one position the last counts.
    changes: Vec<(u32, u32)>,
    zones: Vec<Zone>,
    /// Sorted by start. A region comes after the regions that contain it. Computed on demand.
    regions: OnceCell<Vec<Region>>,
}

#[derive(Copy, Clone)]
enum What {
    Scope(ScopeKind, Block, u32),
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

/// By start. Of two that start together, the one that ends later contains the other.
#[inline]
fn sort_key(start: u32, end: u32, rank: u8, index: usize) -> u128 {
    let range = u128::from(start) << 32 | u128::from(u32::MAX - end);
    range << 64 | u128::from(rank) << 32 | index as u128
}

fn rank_of(kind: ScopeKind, block: Block) -> u8 {
    match kind {
        ScopeKind::Global => 0,
        ScopeKind::Module => 1,
        ScopeKind::Function if block == Block::File => 1,
        ScopeKind::With => 2,
        ScopeKind::ClassFieldInitializer => 3,
        ScopeKind::FunctionExpressionName => 4,
        _ => 5,
    }
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
        let written = hir
            .text
            .get(*pos as usize..*end as usize)
            .unwrap_or_default();
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
        let Collector {
            protos,
            mut zones,
            namespace_exports,
            unvisited,
            ..
        } = Collector::run(file);
        let mut order: Vec<u128> = (protos.iter().enumerate())
            .map(|(i, it)| sort_key(it.start, it.end, it.rank, i))
            .collect();
        order.sort();

        let language = file.language();
        let supports_strict = !is_javascript_mode(file) || language.ecma_version >= 5;
        let mut tree = ScopeTree {
            scopes: Vec::with_capacity(protos.len()),
            of_fn: vec![NONE; file.hir.fns.len()],
            of_class: vec![NONE; file.hir.classes.len()],
            namespace_exports,
            unvisited,
            changes: Vec::with_capacity(protos.len() * 2),
            zones: Vec::new(),
            regions: OnceCell::new(),
        };
        let mut scope_of_proto = vec![NONE; if zones.is_empty() { 0 } else { protos.len() }];
        // What is open: where it ends, the scope that what is written in it belongs to, and
        // whether it is the range of that scope.
        let mut stack: Vec<(u32, u32, bool)> = Vec::new();
        for &key in &order {
            let index = key as u32;
            let proto = protos[index as usize];
            while let Some(&(end, from, is_scope)) = stack.last()
                && end <= proto.start
            {
                if is_scope {
                    tree.scopes[from as usize].last = tree.scopes.len() as u32 - 1;
                }
                stack.pop();
                tree.changes.push((end, stack.last().map_or(0, |it| it.1)));
            }
            let (around_end, outer, _) = stack.last().copied().unwrap_or((u32::MAX, NONE, false));
            // After a syntax error ranges can overlap.
            let end = proto.end.min(around_end);
            match proto.what {
                What::Lifted => {
                    let parent = tree.scopes.get(outer as usize).map_or(NONE, |it| it.parent);
                    if parent != NONE {
                        tree.changes.push((proto.start, parent));
                        stack.push((end, parent, false));
                    }
                }
                What::Scope(kind, block, body_start) => {
                    let id = tree.scopes.len() as u32;
                    if let Some(slot) = scope_of_proto.get_mut(index as usize) {
                        *slot = id;
                    }
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
                        start: proto.start,
                        end,
                    });
                    tree.changes.push((proto.start, id));
                    stack.push((end, id, true));
                }
            }
        }
        let last = tree.scopes.len() as u32 - 1;
        while let Some((end, from, is_scope)) = stack.pop() {
            if is_scope {
                tree.scopes[from as usize].last = last;
            }
            tree.changes.push((end, stack.last().map_or(0, |it| it.1)));
        }
        for zone in &mut zones {
            zone.scope = scope_of_proto[zone.scope as usize];
        }
        tree.zones = zones;
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
            (ScopeKind::Global, _) => {
                !has_top_level_function(file) && has_use_strict(file, top_level())
            }
            (ScopeKind::Function, Block::File) => has_use_strict(file, top_level()),
            (ScopeKind::Function, Block::Fn(f)) => {
                match file.hir.fns.get(f.idx()).map(|it| it.body) {
                    Some(hir::FnBody::Block(statements)) => {
                        let ids = file.hir.ids.get(statements.range()).unwrap_or_default();
                        has_use_strict(file, ids.iter().map(|&it| hir::StmtId(it)))
                    }
                    _ => false,
                }
            }
            _ => false,
        }
    }

    /// ESLint's `reference.from` for what is written at `pos`.
    pub(crate) fn scope_at(&self, pos: u32) -> u32 {
        let after = self.changes.partition_point(|it| it.0 <= pos);
        self.changes.get(after.wrapping_sub(1)).map_or(0, |it| it.1)
    }

    fn regions(&self) -> &[Region] {
        self.regions.get_or_init(|| {
            let scopes = self.scopes.iter().enumerate();
            let scopes =
                scopes.map(|(i, it)| sort_key(it.start, it.end, rank_of(it.kind, it.block), i));
            let zones = self.zones.iter().enumerate();
            let zones = zones.map(|(i, it)| sort_key(it.start, it.end, 2, self.scopes.len() + i));
            let mut order: Vec<u128> = scopes.chain(zones).collect();
            order.sort();
            let mut regions: Vec<Region> = Vec::with_capacity(order.len());
            let mut stack: Vec<u32> = Vec::new();
            for key in order {
                let index = key as u32 as usize;
                let (start, end, get) = match self.scopes.get(index) {
                    Some(it) => (it.start, it.end, index as u32),
                    None => {
                        let it = self.zones[index - self.scopes.len()];
                        (it.start, it.end, it.scope)
                    }
                };
                while stack
                    .last()
                    .is_some_and(|&top| regions[top as usize].end <= start)
                {
                    stack.pop();
                }
                let region = regions.len() as u32;
                let around = stack.last().copied();
                regions.push(Region {
                    start,
                    end: around.map_or(end, |it| end.min(regions[it as usize].end)),
                    parent: around.unwrap_or(region),
                    get,
                });
                stack.push(region);
            }
            regions
        })
    }

    /// ESLint's `getScope` for a node with this range. `block`: the node, if a node of its sort
    /// can create a scope.
    pub(crate) fn scope_of_node(&self, start: u32, end: u32, block: Option<Block>) -> u32 {
        let regions = self.regions();
        let after = regions.partition_point(|it| it.start <= start);
        let mut at = after.saturating_sub(1);
        loop {
            let region = &regions[at];
            if block.is_some() && self.scopes.get(region.get as usize).map(|it| it.block) == block {
                return region.get;
            }
            // What has the range of the node is created by something in the node.
            let is_around =
                end.max(start + 1) <= region.end && (region.start, region.end) != (start, end);
            if is_around || region.parent as usize == at {
                return region.get;
            }
            at = region.parent as usize;
        }
    }

    /// Finds the scopes of positions that do not decrease.
    pub(crate) fn cursor(&self) -> Cursor<'_> {
        Cursor {
            changes: self.changes.iter(),
            from: 0,
            until: 0,
            then: 0,
        }
    }

    /// Whether `inner` is `outer` or inside it.
    #[inline]
    pub(crate) fn contains(&self, outer: u32, inner: u32) -> bool {
        outer <= inner
            && self
                .scopes
                .get(outer as usize)
                .is_some_and(|it| inner <= it.last)
    }
}

pub(crate) struct Cursor<'t> {
    /// Those of `ScopeTree::changes` after `until`.
    changes: std::slice::Iter<'t, (u32, u32)>,
    /// `ScopeTree::scope_at` for the positions from the last one up to `until`.
    from: u32,
    until: u32,
    /// The scope from `until` on.
    then: u32,
}

impl Cursor<'_> {
    /// `ScopeTree::scope_at` for `pos`, which is not less than in the call before.
    #[inline]
    pub(crate) fn seek(&mut self, pos: u32) -> u32 {
        while pos >= self.until {
            self.from = self.then;
            (self.until, self.then) = self
                .changes
                .next()
                .copied()
                .unwrap_or((u32::MAX, self.then));
            if self.until == u32::MAX {
                break;
            }
        }
        self.from
    }
}

/// Lists every scope of the file, and the parts of the nodes that create them that are outside
/// them.
struct Collector<'f, 'a> {
    file: &'f File<'a>,
    is_javascript: bool,
    /// Before ES2015 only functions, `catch` and `with` create scopes.
    has_block_scopes: bool,
    protos: Vec<Proto>,
    /// `Zone::scope` is an index into `protos`.
    zones: Vec<Zone>,
    namespace_exports: Vec<hir::StmtId>,
    unvisited: Vec<(u32, u32)>,
    /// `hir::File::body_starts` by `FnId`.
    body_starts: Vec<u32>,
}

impl<'f, 'a> Collector<'f, 'a> {
    #[inline(never)]
    fn run(file: &'f File<'a>) -> Collector<'f, 'a> {
        let hir = &file.hir;
        let is_javascript = is_javascript_mode(file);
        let mut all = Collector {
            file,
            is_javascript,
            has_block_scopes: !is_javascript || file.language().ecma_version >= 2015,
            protos: Vec::with_capacity(hir.fns.len() * 2 + hir.classes.len() + 8),
            zones: Vec::new(),
            namespace_exports: Vec::new(),
            unvisited: Vec::new(),
            body_starts: vec![0; hir.fns.len()],
        };
        for &(function, start) in hir.body_starts {
            if let Some(slot) = all.body_starts.get_mut(function.idx()) {
                *slot = start;
            }
        }
        all.scope(ScopeKind::Global, Block::File, 0, u32::MAX);
        if has_top_level_function(file) {
            all.scope(ScopeKind::Function, Block::File, 0, u32::MAX);
        }
        if file.language().scope_source_type() == SourceType::Module && all.has_block_scopes {
            all.scope(ScopeKind::Module, Block::File, 0, u32::MAX);
        }
        let (scopes, nodes) = (file.binding.scopes(), file.binding.scope_nodes());
        match scopes.len() == nodes.len() {
            true => all.what_the_binder_lists(scopes, nodes),
            false => all.what_the_tree_has(),
        }
        all
    }

    /// The binder goes through the file nearly in source order.
    fn what_the_binder_lists(&mut self, scopes: &[bind::Scope], nodes: &[ScopeNode]) {
        let hir = &self.file.hir;
        for (scope, node) in scopes.iter().zip(nodes) {
            match (scope.kind, *node) {
                (bind::ScopeKind::Fn(f), _) => self.function(f.idx()),
                (bind::ScopeKind::Class(c), _) => {
                    self.class(c.idx());
                    let members = hir
                        .classes
                        .get(c.idx())
                        .map(|it| it.members)
                        .unwrap_or_default();
                    members.iter().for_each(|m| self.member(m.idx()));
                }
                (bind::ScopeKind::Block, ScopeNode::Stmt(s)) => self.statement(s.idx()),
                _ if self.is_javascript => {}
                (bind::ScopeKind::TypeParams, ScopeNode::Type(t)) => self.ty(t.idx()),
                (bind::ScopeKind::Interface(i), _) => self.interface(hir.interfaces.get(i.idx())),
                (bind::ScopeKind::TypeAlias(a), _) => self.alias(hir.aliases.get(a.idx())),
                (bind::ScopeKind::Enum(e), _) => self.enumeration(hir.enums.get(e.idx())),
                (bind::ScopeKind::Module(m), _) => self.module(hir.modules.get(m.idx())),
                _ => {}
            }
        }
        // To the binder neither is a scope.
        let has_with = !hir.with_bodies.is_empty();
        if has_with || !self.is_javascript {
            for (i, stmt) in hir.stmts.iter().enumerate() {
                if matches!(stmt.kind, StmtKind::ExportAsNamespace(_))
                    || has_with && is_with_statement(self.file, stmt)
                {
                    self.statement(i);
                }
            }
        }
    }

    fn what_the_tree_has(&mut self) {
        let hir = &self.file.hir;
        (0..hir.stmts.len()).for_each(|i| self.statement(i));
        (0..hir.fns.len()).for_each(|i| self.function(i));
        (0..hir.classes.len()).for_each(|i| self.class(i));
        (0..hir.members.len()).for_each(|i| self.member(i));
        if self.is_javascript {
            return;
        }
        (0..hir.types.len()).for_each(|i| self.ty(i));
        hir.interfaces
            .iter()
            .for_each(|it| self.interface(Some(it)));
        hir.aliases.iter().for_each(|it| self.alias(Some(it)));
        hir.enums.iter().for_each(|it| self.enumeration(Some(it)));
        hir.modules.iter().for_each(|it| self.module(Some(it)));
    }

    #[inline]
    fn is_synthetic(&self, pos: u32) -> bool {
        self.file.has_synthetic_nodes() && self.file.is_in_jsdoc(pos)
    }

    #[inline]
    fn scope(&mut self, kind: ScopeKind, block: Block, start: u32, end: u32) {
        self.protos.push(Proto {
            start,
            end,
            rank: rank_of(kind, block),
            what: What::Scope(kind, block, 0),
        });
    }

    /// Adds the scope, and `[start, inside)` as a part of its node that is outside it.
    #[inline]
    fn scope_from(&mut self, kind: ScopeKind, block: Block, start: u32, inside: u32, end: u32) {
        if start < inside {
            self.zones.push(Zone {
                start,
                end: inside,
                scope: self.protos.len() as u32,
            });
        }
        self.scope(kind, block, inside, end);
    }

    fn statement(&mut self, i: usize) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        let Some(stmt) = hir.stmts.get(i) else {
            return;
        };
        let is_scope = matches!(
            stmt.kind,
            StmtKind::Block(_)
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::Switch { .. }
                | StmtKind::Try { .. }
                | StmtKind::ExportAsNamespace(_)
        );
        if !is_scope || matches!(bound.stmt_parent.get(i), None | Some(Parent::None)) {
            return;
        }
        let declares_lexically = |head: hir::StmtId| {
            matches!(hir.stmts.get(head.idx()).map(|it| it.kind), Some(StmtKind::Var(decls))
                if hir.var_decls.get(decls.start as usize).is_some_and(|it| it.kind != VarKind::Var))
        };
        let (block, start, end) = (Block::Stmt(hir::StmtId(i as u32)), stmt.start, stmt.loc.end);
        match stmt.kind {
            StmtKind::Block(parts) if is_with_statement(self.file, stmt) => {
                let object = hir
                    .ids
                    .get(parts.start as usize)
                    .and_then(|&it| hir.stmts.get(it as usize));
                let inside = object.map_or(start, |it| it.loc.end);
                self.scope_from(ScopeKind::With, block, start, inside, end);
            }
            StmtKind::Block(_) if self.has_block_scopes => {
                self.scope(ScopeKind::Block, block, start, end)
            }
            StmtKind::For { init: head, .. }
            | StmtKind::ForIn { left: head, .. }
            | StmtKind::ForOf { left: head, .. }
                if declares_lexically(head) =>
            {
                self.scope(ScopeKind::For, block, start, end);
            }
            StmtKind::Switch { expr, .. } if self.has_block_scopes => {
                let inside = hir.exprs.get(expr.idx()).map_or(start, |it| it.end);
                self.scope_from(ScopeKind::Switch, block, start, inside, end);
            }
            StmtKind::Try {
                block: tried,
                param,
                handler,
                ..
            } => {
                if let (Some(tried), Some(handler)) =
                    (hir.stmts.get(tried.idx()), hir.stmts.get(handler.idx()))
                {
                    self.scope(ScopeKind::Catch, block, tried.loc.end, handler.loc.end);
                }
                let ty = hir
                    .var_decls
                    .get(param.idx())
                    .and_then(|it| hir.types.get(it.ty.idx()));
                self.unvisited.extend(ty.map(|it| (it.pos, it.end)));
            }
            StmtKind::ExportAsNamespace(_) => self.namespace_exports.push(hir::StmtId(i as u32)),
            _ => {}
        }
    }

    fn function(&mut self, i: usize) {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        let (Some(func), Some(kind)) = (hir.fns.get(i), kind_of_function(file, i)) else {
            return;
        };
        if self.is_synthetic(func.start) || (self.is_javascript && kind == ScopeKind::FunctionType)
        {
            return;
        }
        let range = match bound.fns.get(i).map(|it| it.owner) {
            Some(FnOwner::Expr(e)) => hir.exprs.get(e.idx()).map(|e| (e.pos, e.end)),
            Some(FnOwner::Stmt(s)) => hir.stmts.get(s.idx()).map(|s| (s.start, s.loc.end)),
            Some(FnOwner::Member(m)) => hir.members.get(m.idx()).map(|m| (m.start, m.loc.end)),
            Some(FnOwner::Type(t)) => hir.types.get(t.idx()).map(|t| (t.pos, t.end)),
            Some(FnOwner::None) | None => None,
        };
        let Some((whole_start, end)) = range else {
            return;
        };
        let block = Block::Fn(hir::FnId(i as u32));
        // After the name.
        let from_params = match hir.type_params.get(func.type_params.start as usize) {
            // Not those of a `@template` tag.
            Some(first) if !func.type_params.is_empty() && !self.is_synthetic(first.start) => {
                first.start
            }
            _ => func.anchor,
        };
        match func.kind {
            FnKind::StaticBlock
            | FnKind::Arrow
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType => self.scope(kind, block, whole_start, end),
            FnKind::Expr if func.name.is_some() => {
                self.scope(ScopeKind::FunctionExpressionName, block, whole_start, end);
                self.scope(kind, block, from_params, end);
            }
            // The block of a method signature is the member.
            _ if kind == ScopeKind::FunctionType => {
                self.scope_from(kind, block, whole_start, from_params, end)
            }
            _ => self.scope(kind, block, from_params, end),
        }
        if kind != ScopeKind::Function {
            return;
        }
        let body_start = match func.body {
            hir::FnBody::None => 0,
            hir::FnBody::Expr(e) => hir.exprs.get(e.idx()).map_or(0, |it| it.pos),
            hir::FnBody::Block(_) => match self.body_starts[i] {
                0 => func.anchor,
                start => start,
            },
        };
        if let Some(Proto {
            what: What::Scope(_, _, slot),
            ..
        }) = self.protos.last_mut()
        {
            *slot = body_start;
        }
        // The decorators of the parameters of a method are evaluated in the scope of the class.
        if !hir.modifiers_of_params.is_empty()
            && matches!(
                bound.fns.get(i).map(|it| it.owner),
                Some(FnOwner::Member(_))
            )
            && !matches!(func.body, hir::FnBody::None)
        {
            for p in func.params.iter() {
                let modifiers = hir
                    .modifiers_of_params
                    .get(p.idx())
                    .copied()
                    .unwrap_or_default();
                let decorators_end = hir
                    .modifiers
                    .get(modifiers.range())
                    .unwrap_or_default()
                    .iter();
                let decorators_end = decorators_end
                    .filter_map(|it| match it.kind {
                        hir::ModifierKind::Decorator(e) => hir.exprs.get(e.idx()).map(|e| e.end),
                        hir::ModifierKind::Keyword(_) => None,
                    })
                    .max();
                if let (Some(end), Some(param)) = (decorators_end, hir.params.get(p.idx())) {
                    self.protos.push(Proto {
                        start: param.pos,
                        end,
                        rank: 5,
                        what: What::Lifted,
                    });
                }
            }
        }
    }

    fn class(&mut self, i: usize) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        let Some(class) = hir.classes.get(i) else {
            return;
        };
        let end = match bound.class_owner.get(i) {
            Some(&ClassOwner::Expr(e)) => hir.exprs.get(e.idx()).map(|it| it.end),
            Some(&ClassOwner::Stmt(s)) => hir.stmts.get(s.idx()).map(|it| it.loc.end),
            None => None,
        };
        let is_reached = bound.class_scope.get(i).is_some_and(|it| it.is_some());
        let (Some(end), true) = (end, is_reached) else {
            return;
        };
        // After the name, or else after the modifiers.
        let inside = match class.name.is_some() {
            true => class.name_pos + 1,
            false => {
                let modifiers = hir
                    .modifiers
                    .get(class.modifiers.range())
                    .unwrap_or_default();
                let ends = modifiers.iter().map(|it| match it.kind {
                    hir::ModifierKind::Decorator(e) => {
                        hir.exprs.get(e.idx()).map_or(it.pos, |e| e.end)
                    }
                    hir::ModifierKind::Keyword(_) => it.pos + 1,
                });
                ends.max().unwrap_or(class.start).max(class.start)
            }
        };
        let block = Block::Class(hir::ClassId(i as u32));
        self.scope_from(ScopeKind::Class, block, class.start, inside, end);
    }

    /// The initializer of a field of a class.
    #[inline]
    fn member(&mut self, i: usize) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        if let Some(member) = hir.members.get(i)
            && member.init.is_some()
            && member.kind == hir::MemberKind::Property
            && matches!(bound.member_owner.get(i), Some(MemberOwner::Class(_)))
            && let Some(init) = hir.exprs.get(member.init.idx())
        {
            // The HIR positions a class expression after its decorators.
            let start = match init.kind {
                hir::ExprKind::Class(c) => hir
                    .classes
                    .get(c.idx())
                    .map_or(init.pos, |it| it.start.min(init.pos)),
                _ => init.pos,
            };
            self.scope(
                ScopeKind::ClassFieldInitializer,
                Block::Expr(member.init),
                start,
                init.end,
            );
        }
    }

    fn ty(&mut self, i: usize) {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        let Some(ty) = hir.types.get(i) else {
            return;
        };
        if !matches!(ty.kind, TypeNodeKind::Cond { .. } | TypeNodeKind::Mapped(_))
            || bound.type_scope.get(i).is_none_or(|it| it.is_none())
            || self.is_synthetic(ty.pos)
        {
            return;
        }
        let block = Block::Type(hir::TypeNodeId(i as u32));
        match ty.kind {
            TypeNodeKind::Cond { yes, .. } => {
                let inside_end = hir
                    .types
                    .get(yes.idx())
                    .map_or(ty.end, |it| it.end)
                    .min(ty.end);
                self.zones.push(Zone {
                    start: inside_end,
                    end: ty.end,
                    scope: self.protos.len() as u32,
                });
                self.scope(ScopeKind::ConditionalType, block, ty.pos, inside_end);
            }
            _ => self.scope(ScopeKind::MappedType, block, ty.pos, ty.end),
        }
    }

    fn declaration(&mut self, kind: ScopeKind, s: hir::StmtId, name_pos: u32) {
        if let Some(stmt) = self.file.hir.stmts.get(s.idx())
            && !matches!(
                self.file.bound.stmt_parent.get(s.idx()),
                None | Some(Parent::None)
            )
            && !self.is_synthetic(name_pos)
        {
            self.scope_from(kind, Block::Stmt(s), stmt.start, name_pos + 1, stmt.loc.end);
        }
    }

    fn interface(&mut self, it: Option<&hir::Interface>) {
        if let Some(it) = it.filter(|it| !it.type_params.is_empty()) {
            self.declaration(ScopeKind::Type, it.stmt, it.name_pos);
        }
    }

    fn alias(&mut self, it: Option<&hir::Alias>) {
        if let Some(it) = it.filter(|it| !it.type_params.is_empty()) {
            self.declaration(ScopeKind::Type, it.stmt, it.name_pos);
        }
    }

    fn enumeration(&mut self, it: Option<&hir::Enum>) {
        if let Some(it) = it {
            self.declaration(ScopeKind::TsEnum, it.stmt, it.name_pos);
        }
    }

    fn module(&mut self, it: Option<&'a hir::Module>) {
        // `namespace A.B.C { }` is one declaration, which the HIR stores as three.
        if let Some(it) = it.filter(|it| !is_after_dot(self.file, it)) {
            self.declaration(ScopeKind::TsModule, it.stmt, last_name_pos(self.file, it));
        }
    }
}

/// `with (object) body`, which the HIR stores as a block of the two.
pub(crate) fn is_with_statement(file: &File, stmt: &hir::Stmt) -> bool {
    !file.hir.with_bodies.is_empty()
        && matches!(stmt.kind, StmtKind::Block(parts) if parts.len() == 2)
        && file
            .hir
            .text
            .get(stmt.start as usize..)
            .is_some_and(|it| it.starts_with(b"with"))
}

/// Whether `module` is the `B` of `namespace A.B`.
pub(crate) fn is_after_dot(file: &File, module: &hir::Module) -> bool {
    file.hir
        .stmts
        .get(module.stmt.idx())
        .is_some_and(|it| it.start == module.name_pos)
        && matches!(module.name, hir::ModuleName::Ident(_))
}

/// The `B` of the `A` of `namespace A.B`.
pub(crate) fn after_dot<'a>(file: &File<'a>, module: &hir::Module) -> Option<&'a hir::Module> {
    if module.body.len() != 1 {
        return None;
    }
    let only = file
        .hir
        .stmts
        .get(*file.hir.ids.get(module.body.start as usize)? as usize)?;
    match only.kind {
        StmtKind::Module(inner) => file
            .hir
            .modules
            .get(inner.idx())
            .filter(|it| is_after_dot(file, it)),
        _ => None,
    }
}

fn last_name_pos<'a>(file: &File<'a>, mut module: &'a hir::Module) -> u32 {
    while let Some(inner) = after_dot(file, module) {
        module = inner;
    }
    module.name_pos
}
