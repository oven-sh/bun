//! A file's scopes, matching ESLint's.
//!
//! A scope is a range of the source text, so the tree follows from the positions of the nodes that
//! create scopes. Those nodes are listed, sorted by position, and swept with a stack. Scopes are
//! numbered in the order they start, which makes a scope's nested scopes a contiguous range of
//! numbers.

use super::ScopeKind;
use crate::ast::{File, ImportAttributes};
use crate::language::{Parser, SourceType};
use crate::runner::in_walk_order;
use bun_sema::bind::{ClassOwner, FnOwner, MemberOwner, Parent, kind_counts};
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
    /// A class field's initializer.
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
    /// For a function with a body, the body's start. 0 for every other scope.
    pub(crate) body_start: u32,
    /// Its range in the text.
    start: u32,
    end: u32,
}

/// A part of a scope-creating node that's outside the scope: a `switch`'s discriminant, a `with`'s
/// object, a class's decorators, a conditional type's false branch. ESLint's `getScope` still
/// returns that scope for a node here.
#[derive(Copy, Clone)]
struct Zone {
    start: u32,
    end: u32,
    scope: u32,
}

/// A text range with the scope that ESLint's `getScope` returns for a node in it, unless the node
/// is in a nested region.
#[derive(Copy, Clone, Debug)]
struct Region {
    start: u32,
    end: u32,
    /// The enclosing region. The first region is its own parent.
    parent: u32,
    get: u32,
}

pub(crate) struct ScopeTree {
    pub(crate) scopes: Vec<ScopeData>,
    /// Indexed by `FnId`.
    pub(crate) scope_of_fn: Vec<u32>,
    /// Indexed by `ClassId`.
    pub(crate) scope_of_class: Vec<u32>,
    /// The `export as namespace N` statements.
    pub(crate) namespace_exports: Vec<hir::StmtId>,
    /// The ranges that typescript-eslint doesn't visit, which therefore contain no scopes,
    /// variables or references: the types of `catch` parameters and the options of import types.
    /// oxc visits them.
    pub(crate) unvisited: Vec<(u32, u32)>,
    /// Each position where the text starts to belong to a different scope. Sorted. If several have
    /// the same position, the last one counts.
    changes: Vec<Change>,
    zones: Vec<Zone>,
    /// Sorted by start. A region comes after the regions that contain it. Computed on demand.
    regions: OnceCell<Vec<Region>>,
    /// The start of each of `zones`, sorted, with the highest end among the zones up to it.
    /// Computed on demand.
    zone_ends: OnceCell<Vec<(u32, u32)>>,
    /// True if some part of a scope is evaluated in the enclosing scope. A scope in such a part has
    /// that enclosing scope as its `parent`, not the scope whose range it's in.
    has_lifted_parts: bool,
}

#[derive(Copy, Clone)]
struct Change {
    pos: u32,
    /// The scope that the text from `pos` on belongs to: ESLint's `reference.from`.
    from: u32,
    step: Step,
}

/// The effect of a [`Change`] on the scopes whose range contains `pos`.
#[derive(Copy, Clone)]
pub(crate) enum Step {
    /// The scope's range starts.
    Enter(u32),
    /// It ends.
    Leave(u32),
    /// A part of the scope's range starts that's evaluated in the enclosing scope.
    Suspend(u32),
    /// It ends.
    Resume(u32),
}

#[derive(Copy, Clone)]
enum What {
    Scope(ScopeKind, Block, u32),
    /// A part of a scope that's evaluated in the enclosing scope.
    Lifted,
}

#[derive(Copy, Clone)]
struct Proto {
    start: u32,
    end: u32,
    /// Among equal ranges, the lower rank contains the higher.
    rank: u8,
    what: What,
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

/// True if the file is analyzed the way `eslint-scope` does it. Otherwise it's analyzed like
/// `@typescript-eslint/scope-manager`, which is what oxlint gives its JavaScript plugins for every
/// file.
#[inline]
pub(crate) fn is_javascript_mode(file: &File) -> bool {
    let language = file.language();
    file.is_javascript()
        && language.parser != Parser::TypeScript
        && (!language.is_oxlint || file.has_oxc_scopes())
}

/// ESLint's `scopeManager.isGlobalReturn()`.
#[inline]
pub(crate) fn has_top_level_function(file: &File) -> bool {
    file.language().has_function_scope_at_top_level()
}

/// The kind of scope that a function creates.
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

/// True if the scope is strict for oxc, in a file that isn't a module: it's in a class or under a
/// `"use strict"`. [`ScopeData::is_strict`] treats every file as a module there.
pub(crate) fn is_strict_for_oxc<'a>(file: &'a File<'a>, tree: &ScopeTree, scope: u32) -> bool {
    let mut at = tree.scopes.get(scope as usize);
    while let Some(it) = at {
        let is_strict = match (it.kind, it.block) {
            (ScopeKind::Class, _) => true,
            (_, Block::File) => has_use_strict(file, file.body().iter().map(|it| it.id())),
            (_, Block::Fn(f)) => match file.hir.fns.get(f.idx()).map(|it| it.body) {
                Some(hir::FnBody::Block(statements)) => {
                    let ids = file.hir.ids.get(statements.range()).unwrap_or_default();
                    has_use_strict(file, ids.iter().map(|&it| hir::StmtId(it)))
                }
                _ => false,
            },
            _ => false,
        };
        if is_strict {
            return true;
        }
        at = tree.scopes.get(it.parent as usize);
    }
    false
}

/// True if the statements start with a `"use strict"` directive.
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
        let raw_text = hir
            .text
            .get(*pos as usize..*end as usize)
            .unwrap_or_default();
        // A template or a parenthesized string isn't a directive.
        if !matches!(raw_text.first(), Some(b'"' | b'\''))
            || hir.parens.binary_search_by_key(&e.0, |it| it.0.0).is_ok()
        {
            return false;
        }
        if raw_text.get(1..raw_text.len() - 1) == Some(b"use strict") {
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
        // Of two that start together, the one that ends later contains the other.
        let order = in_walk_order(protos.iter().map(|it| it.start), &|at| {
            protos
                .get(at as usize)
                .map_or((0, 0), |it| (it.end, it.rank))
        });

        let language = file.language();
        let supports_strict = !is_javascript_mode(file) || language.ecma_version >= 5;
        let mut tree = ScopeTree {
            scopes: Vec::with_capacity(protos.len()),
            scope_of_fn: vec![NONE; file.hir.fns.len()],
            scope_of_class: vec![NONE; file.hir.classes.len()],
            namespace_exports,
            unvisited,
            changes: Vec::with_capacity(protos.len() * 2),
            zones: Vec::new(),
            regions: OnceCell::new(),
            zone_ends: OnceCell::new(),
            has_lifted_parts: false,
        };
        let mut scope_of_proto = vec![NONE; if zones.is_empty() { 0 } else { protos.len() }];
        // The open ranges: each one's end, the scope that the text in it belongs to, and the step
        // at its end.
        let mut stack: Vec<(u32, u32, Step)> = Vec::new();
        for &key in &order {
            let index = key as u32;
            let proto = protos[index as usize];
            while let Some(&(end, _, step)) = stack.last()
                && end <= proto.start
            {
                if let Step::Leave(scope) = step {
                    tree.scopes[scope as usize].last = tree.scopes.len() as u32 - 1;
                }
                stack.pop();
                tree.changes.push(Change {
                    pos: end,
                    from: stack.last().map_or(0, |it| it.1),
                    step,
                });
            }
            let (enclosing_end, outer) = stack.last().map_or((u32::MAX, NONE), |it| (it.0, it.1));
            // After a syntax error ranges can overlap.
            let end = proto.end.min(enclosing_end);
            match proto.what {
                What::Lifted => {
                    tree.has_lifted_parts = true;
                    let parent = tree.scopes.get(outer as usize).map_or(NONE, |it| it.parent);
                    if parent != NONE {
                        tree.changes.push(Change {
                            pos: proto.start,
                            from: parent,
                            step: Step::Suspend(outer),
                        });
                        stack.push((end, parent, Step::Resume(outer)));
                    }
                }
                What::Scope(kind, block, body_start) => {
                    let id = tree.scopes.len() as u32;
                    if let Some(slot) = scope_of_proto.get_mut(index as usize) {
                        *slot = id;
                    }
                    match block {
                        Block::Fn(f) if kind != ScopeKind::FunctionExpressionName => {
                            tree.scope_of_fn[f.idx()] = id;
                        }
                        Block::Class(c) => tree.scope_of_class[c.idx()] = id,
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
                    tree.changes.push(Change {
                        pos: proto.start,
                        from: id,
                        step: Step::Enter(id),
                    });
                    stack.push((end, id, Step::Leave(id)));
                }
            }
        }
        let last = tree.scopes.len() as u32 - 1;
        while let Some((end, _, step)) = stack.pop() {
            if let Step::Leave(scope) = step {
                tree.scopes[scope as usize].last = last;
            }
            tree.changes.push(Change {
                pos: end,
                from: stack.last().map_or(0, |it| it.1),
                step,
            });
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

    /// ESLint's `reference.from` for the text at `pos`.
    pub(crate) fn scope_at(&self, pos: u32) -> u32 {
        let after = self.changes.partition_point(|it| it.pos <= pos);
        self.changes
            .get(after.wrapping_sub(1))
            .map_or(0, |it| it.from)
    }

    fn regions(&self) -> &[Region] {
        self.regions.get_or_init(|| {
            let starts = self.scopes.iter().map(|it| it.start);
            let starts = starts.chain(self.zones.iter().map(|it| it.start));
            let order = in_walk_order(starts, &|at| match self.scopes.get(at as usize) {
                Some(it) => (it.end, rank_of(it.kind, it.block)),
                None => (self.zones.get(at as usize - self.scopes.len()))
                    .map_or((0, 2), |it| (it.end, 2)),
            });
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
                let enclosing_region = stack.last().copied();
                regions.push(Region {
                    start,
                    end: enclosing_region.map_or(end, |it| end.min(regions[it as usize].end)),
                    parent: enclosing_region.unwrap_or(region),
                    get,
                });
                stack.push(region);
            }
            regions
        })
    }

    /// True if `pos` is in one of `zones`.
    fn is_in_zone(&self, pos: u32) -> bool {
        let ends = self.zone_ends.get_or_init(|| {
            let zones = self.zones.iter();
            let mut ends: Vec<(u32, u32)> = zones.map(|it| (it.start, it.end)).collect();
            ends.sort_unstable();
            let mut last = 0;
            for it in &mut ends {
                last = last.max(it.1);
                it.1 = last;
            }
            ends
        });
        let after = ends.partition_point(|it| it.0 <= pos);
        (after.checked_sub(1).and_then(|it| ends.get(it))).is_some_and(|it| pos < it.1)
    }

    /// `scope_of_node` for a node that starts outside all `zones`, in a file without lifted parts.
    /// No zone encloses it then, and without zones the regions are exactly the scopes, in the same
    /// order, each with the enclosing one as its `parent`.
    fn scope_of_node_outside_zones(&self, start: u32, end: u32, block: Option<Block>) -> u32 {
        let after = self.scopes.partition_point(|it| it.start <= start);
        let mut at = after.saturating_sub(1);
        while let Some(scope) = self.scopes.get(at) {
            let encloses_node =
                end.max(start + 1) <= scope.end && (scope.start, scope.end) != (start, end);
            if Some(scope.block) == block || encloses_node || scope.parent == NONE {
                break;
            }
            at = scope.parent as usize;
        }
        at as u32
    }

    /// ESLint's `getScope` for a node with this range. `block` is the node, if its sort of node can
    /// create a scope.
    pub(crate) fn scope_of_node(&self, start: u32, end: u32, block: Option<Block>) -> u32 {
        // A debug build takes the fast path wherever it's valid, and compares the results.
        if (cfg!(debug_assertions) || self.regions.get().is_none())
            && !self.has_lifted_parts
            && !self.is_in_zone(start)
        {
            let scope = self.scope_of_node_outside_zones(start, end, block);
            debug_assert_eq!(scope, self.scope_of_node_by_regions(start, end, block));
            return scope;
        }
        self.scope_of_node_by_regions(start, end, block)
    }

    fn scope_of_node_by_regions(&self, start: u32, end: u32, block: Option<Block>) -> u32 {
        let regions = self.regions();
        let after = regions.partition_point(|it| it.start <= start);
        let mut at = after.saturating_sub(1);
        loop {
            let region = &regions[at];
            if block.is_some() && self.scopes.get(region.get as usize).map(|it| it.block) == block {
                return region.get;
            }
            // A region with the node's exact range is created by something inside the node.
            let encloses_node =
                end.max(start + 1) <= region.end && (region.start, region.end) != (start, end);
            if encloses_node || region.parent as usize == at {
                return region.get;
            }
            at = region.parent as usize;
        }
    }

    /// A cursor that finds the scopes of non-decreasing positions.
    pub(crate) fn cursor(&self) -> Cursor<'_> {
        Cursor {
            changes: self.changes.iter(),
            from: 0,
            until: 0,
            then: None,
        }
    }

    /// True if `inner` is `outer` or inside it.
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
    /// The entries of `ScopeTree::changes` after `until`.
    changes: std::slice::Iter<'t, Change>,
    /// `ScopeTree::scope_at` for the positions from the last one up to `until`.
    from: u32,
    until: u32,
    /// The change at `until`.
    then: Option<&'t Change>,
}

impl Cursor<'_> {
    /// `ScopeTree::scope_at` for `pos`, which must not be lower than in the previous call.
    #[inline]
    pub(crate) fn seek(&mut self, pos: u32) -> u32 {
        self.seek_by_steps(pos, |_| {})
    }

    /// Same. `take` is called with every step along the way, in order.
    #[inline(always)]
    pub(crate) fn seek_by_steps(&mut self, pos: u32, take: impl FnMut(Step)) -> u32 {
        if pos >= self.until {
            self.advance_to(pos, take);
        }
        self.from
    }

    #[inline(never)]
    fn advance_to(&mut self, pos: u32, mut take: impl FnMut(Step)) {
        while pos >= self.until {
            if let Some(change) = self.then {
                self.from = change.from;
                take(change.step);
            }
            self.then = self.changes.next();
            self.until = self.then.map_or(u32::MAX, |it| it.pos);
            if self.until == u32::MAX {
                break;
            }
        }
    }
}

/// Lists all of the file's scopes, and the parts of their nodes that are outside them.
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
        all.collect_from_tree();
        all.remove_unvisited();
        all
    }

    /// `TypeVisitor.TSImportType` visits the type arguments and nothing else. `PatternVisitor.TSTypeAnnotation` visits nothing.
    fn remove_unvisited(&mut self) {
        let hir = &self.file.hir;
        if self.is_javascript || self.file.has_oxc_scopes() {
            self.unvisited.clear();
            return;
        }
        if !hir.import_attributes.is_empty() {
            let options = hir.types.iter().filter_map(|ty| {
                let within = ImportAttributes::search_span_of_type(hir, ty)?;
                let mut all = hir.import_attributes.iter();
                let first = all.find(|it| within.contains_offset(it.0))?;
                hir.exprs.get(first.1.idx()).map(|it| (it.pos, it.end))
            });
            self.unvisited.extend(options);
        }
        if self.unvisited.is_empty() {
            return;
        }
        let unvisited = &self.unvisited;
        let is_visited = |pos: u32| !unvisited.iter().any(|it| (it.0..it.1).contains(&pos));
        // The new index of each of `protos`.
        let mut retained_count = 0;
        let new_indexes: Vec<Option<u32>> = (self.protos.iter())
            .map(|it| {
                is_visited(it.start).then(|| {
                    retained_count += 1;
                    retained_count - 1
                })
            })
            .collect();
        self.protos.retain(|it| is_visited(it.start));
        self.zones.retain_mut(|it| {
            let new_index = new_indexes.get(it.scope as usize).copied().flatten();
            it.scope = new_index.unwrap_or(it.scope);
            new_index.is_some()
        });
    }

    fn collect_from_tree(&mut self) {
        let hir = &self.file.hir;
        (0..hir.stmts.len()).for_each(|i| self.statement(i));
        (0..hir.fns.len()).for_each(|i| self.function(i));
        (0..hir.classes.len()).for_each(|i| self.class(i));
        (0..hir.members.len()).for_each(|i| self.member(i));
        if self.is_javascript {
            return;
        }
        // Few files have a type that creates a scope, and the binder has counted them.
        let count = |tag: hir::TypeTag| {
            let counted = self.file.bound.kind_counts;
            counted.get(kind_counts::TYPES + tag as usize).copied()
        };
        if (count(hir::TypeTag::Cond), count(hir::TypeTag::Mapped)) != (Some(0), Some(0)) {
            (0..hir.types.len()).for_each(|i| self.ty(i));
        }
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

    /// Adds the scope, and `[start, inside)` as a part of its node that's outside it.
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
        if !is_scope || matches!(bound.parent_of_stmt(hir::StmtId(i as u32)), Parent::None) {
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
            // Not a `@template` tag's.
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
            // A method signature's block is the member.
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
        // A method's parameter decorators are evaluated in the class's scope.
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

    /// A class field's initializer.
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
            && !matches!(self.file.bound.parent_of_stmt(s), Parent::None)
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
        let Some(it) = it else {
            return;
        };
        // `namespace A.B.C { }` is one declaration, which the HIR stores as three.
        if self.file.has_oxc_scopes() {
            self.declaration(ScopeKind::TsModule, it.stmt, it.name_pos);
        } else if !is_after_dot(self.file, it) {
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

/// True if `module` is the `B` in `namespace A.B`.
pub(crate) fn is_after_dot(file: &File, module: &hir::Module) -> bool {
    file.hir
        .stmts
        .get(module.stmt.idx())
        .is_some_and(|it| it.start == module.name_pos)
        && matches!(module.name, hir::ModuleName::Ident(_))
}

/// Given the `A` in `namespace A.B`, returns the `B`.
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
