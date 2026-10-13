//! Runs rules on a file.

use crate::ast::{
    BinOp, Case, Chain, Class, EnumMember, ExportSpec, Expr, ExprTag, File, Func, Handle,
    ImportSpec, Member, NOT_IN_TREE, Node, Param, Pat, PatElem, PatProp, PatTag, Prop, Stmt,
    StmtTag, TupleElem, TypeNode, TypeParam, TypeTag, UnOp, VarDecl,
};
use crate::context::{Cx, CxBase, Diagnostic, Severity};
use crate::rule::{Meta, NAME_CLASSES, NodeTags, On, Rule, When, name_class};
use crate::rule_set::{NUMBERS, RuleBits, RuleSet};
use crate::span::Span;
use bun_sema::atom::Atom;
use bun_sema::bind::{ClassOwner, FnOwner, MemberOwner, kind_counts};
use bun_sema::hir;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::cell::{Cell, OnceCell};

// ───────────────────────────── the nodes of a file, by kind ─────────────────────────────

/// Indices into one vector of the HIR, grouped by the kind of the node. `ENDS`: one more than there are kinds.
pub(crate) struct Grouped<const ENDS: usize> {
    ids: Vec<u32>,
    /// Where each kind starts in `ids`, and where the last ends.
    starts: [u32; ENDS],
    /// A bit for each kind of which there is a node, if there are no more than 64 kinds.
    present: u64,
}

/// At `kind + 1`: how many of `kinds` are `kind`. A place for each number that there can be: nothing is asked for each of `kinds`.
fn count_kinds(kinds: &[u8]) -> [u32; u8::MAX as usize + 2] {
    let mut counts = [0u32; u8::MAX as usize + 2];
    for &kind in kinds {
        counts[kind as usize + 1] += 1;
    }
    counts
}

impl<const ENDS: usize> Grouped<ENDS> {
    const KINDS: usize = ENDS - 1;

    /// `tags`: writes the kind of each node of a vector of the HIR, `NOT_IN_TREE` to leave it out.
    fn new(tags: impl FnOnce(&mut Vec<u8>)) -> Self {
        let mut kinds = Vec::new();
        tags(&mut kinds);
        Grouped::of_kinds(0..kinds.len() as u32, &kinds)
    }

    /// `kind_of(id)`: the kind of the node `id`, which is one of `all`, or `None` to leave it out.
    fn of_ids(
        all: impl ExactSizeIterator<Item = u32> + Clone,
        kind_of: impl Fn(u32) -> Option<usize>,
    ) -> Self {
        if all.len() == 0 {
            return Grouped::empty();
        }
        let kinds: Vec<u8> = all
            .clone()
            .map(|id| kind_of(id).map_or(NOT_IN_TREE, |kind| kind as u8))
            .collect();
        Grouped::of_kinds(all, &kinds)
    }

    /// `kinds`: the kind of each of `all`, `NOT_IN_TREE` to leave it out.
    fn of_kinds(all: impl Iterator<Item = u32>, kinds: &[u8]) -> Self {
        let mut counts = [0u32; ENDS];
        counts.copy_from_slice(&count_kinds(kinds)[..ENDS]);
        Grouped::of_counted_kinds(all, kinds.iter().copied(), &counts)
    }

    /// A bit for each kind of which there is one, if there are no more than 64 kinds. `counts`: as below.
    fn present(counts: &[u32; ENDS]) -> u64 {
        let kinds = 0..if Self::KINDS <= 64 { Self::KINDS } else { 0 };
        kinds.fold(0, |present, kind| {
            present | u64::from(counts[kind + 1] != 0) << kind
        })
    }

    /// `counts`: at `kind + 1`, how many of `kinds` are `kind`.
    fn of_counted_kinds(
        all: impl Iterator<Item = u32>,
        kinds: impl Iterator<Item = u8>,
        counts: &[u32; ENDS],
    ) -> Self {
        const { assert!(ENDS <= NOT_IN_TREE as usize) };
        let (mut starts, present) = (*counts, Self::present(counts));
        for kind in 0..Self::KINDS {
            starts[kind + 1] += starts[kind];
        }
        // Where the next of each kind goes. What is left out has no place.
        let mut next = [u32::MAX; u8::MAX as usize + 1];
        next[..Self::KINDS].copy_from_slice(&starts[..Self::KINDS]);
        let mut ids = vec![0u32; starts[Self::KINDS] as usize];
        for (id, kind) in all.zip(kinds) {
            let at = &mut next[kind as usize];
            if let Some(place) = ids.get_mut(*at as usize) {
                *place = id;
                *at += 1;
            }
        }
        Grouped {
            ids,
            starts,
            present,
        }
    }

    /// Of no nodes.
    fn empty() -> Self {
        Grouped {
            ids: Vec::new(),
            starts: [0; ENDS],
            present: 0,
        }
    }

    #[inline]
    fn of(&self, kind: usize) -> &[u32] {
        &self.ids[self.starts[kind] as usize..self.starts[kind + 1] as usize]
    }

    /// For assertions.
    fn is_same_as(&self, other: &Self) -> bool {
        (&self.ids, &self.starts, self.present) == (&other.ids, &other.starts, other.present)
    }
}

/// The expressions of a file.
struct Exprs {
    /// Each kind in two parts: first what is not part of an optional chain, then what is.
    grouped: Grouped<{ 2 * ExprTag::COUNT + 1 }>,
    /// A bit for each `ExprTag` of which there is an expression, and for each of which one is part of an optional chain.
    present: u64,
    chained: u64,
}

/// The expression `id` of a group. None of them is a cast that is synthesized from a JSDoc comment, for which a handle stands
/// for the operand.
#[inline(always)]
fn grouped_expr<'a>(file: &'a File<'a>, id: u32) -> Expr<'a> {
    Expr {
        file,
        id: hir::ExprId(id),
    }
}

impl Exprs {
    fn new(file: &File) -> Exprs {
        let mut exprs = Exprs::from_binder(file).unwrap_or_else(|| Exprs::from_hir(file));
        let starts = &exprs.grouped.starts;
        for kind in 0..ExprTag::COUNT {
            let (first, chained, end) =
                (starts[2 * kind], starts[2 * kind + 1], starts[2 * kind + 2]);
            exprs.present |= u64::from(first < end) << kind;
            exprs.chained |= u64::from(chained < end) << kind;
        }
        exprs
    }

    /// From the kinds that the binder has noted on its way, if it has. They are those of the HIR, in which a template without
    /// substitutions is a string.
    fn from_binder(file: &File) -> Option<Exprs> {
        let (kinds, counted) = (file.bound.expr_kinds, file.bound.expr_kind_counts);
        if !file.groups_exprs_as_the_binder() {
            return None;
        }
        let mut counts = [0u32; 2 * ExprTag::COUNT + 1];
        counts.get_mut(1..=counted.len())?.copy_from_slice(counted);
        let mut grouped: Grouped<{ 2 * ExprTag::COUNT + 1 }> =
            Grouped::of_counted_kinds(0..kinds.len() as u32, kinds.iter().copied(), &counts);
        if bun_core::strings::contains_char(file.text(), b'`') {
            let (strings, templates) =
                (2 * ExprTag::String as usize, 2 * ExprTag::Template as usize);
            const { assert!((ExprTag::String as usize) < ExprTag::Template as usize) };
            let starts_with_backtick = |id: u32| {
                let raw = file.hir.exprs.get(id as usize);
                raw.is_some_and(|it| file.text().get(it.pos as usize) == Some(&b'`'))
            };
            let is_template = |id: &u32| {
                starts_with_backtick(*id)
                    && file.expr_in_tree(*id as usize) == Some(ExprTag::Template)
            };
            let moved: Vec<u32> = grouped
                .of(strings)
                .iter()
                .copied()
                .filter(is_template)
                .collect();
            if !moved.is_empty() {
                // The strings that stay, what is between the two kinds, and the templates of both origins by their index.
                let (start, end) = (
                    grouped.starts[strings] as usize,
                    grouped.starts[templates + 1] as usize,
                );
                let mut rest: Vec<u32> = grouped
                    .of(strings)
                    .iter()
                    .copied()
                    .filter(|id| !is_template(id))
                    .collect();
                rest.extend_from_slice(
                    &grouped.ids
                        [grouped.starts[strings + 1] as usize..grouped.starts[templates] as usize],
                );
                let mut all_templates = [grouped.of(templates), &moved[..]].concat();
                all_templates.sort_unstable();
                rest.extend_from_slice(&all_templates);
                grouped.ids.get_mut(start..end)?.copy_from_slice(&rest);
                for first in &mut grouped.starts[strings + 1..=templates] {
                    *first -= moved.len() as u32;
                }
            }
        }
        Some(Exprs {
            grouped,
            present: 0,
            chained: 0,
        })
    }

    fn from_hir(file: &File) -> Exprs {
        let (mut kinds, mut counts) = (Vec::new(), [0u32; 2 * ExprTag::COUNT + 1]);
        file.expr_tags_in_tree_as(&mut kinds, |tag, raw| {
            let chain = match raw.kind {
                hir::ExprKind::Dot { chain, .. } | hir::ExprKind::Index { chain, .. } => chain,
                hir::ExprKind::Call(call) => file
                    .hir
                    .calls
                    .get(call.idx())
                    .map_or(Chain::No, |call| call.chain),
                _ => Chain::No,
            };
            let kind = 2 * tag as u8 + u8::from(chain != Chain::No);
            counts[kind as usize + 1] += 1;
            kind
        });
        Exprs {
            grouped: Grouped::of_counted_kinds(
                0..kinds.len() as u32,
                kinds.iter().copied(),
                &counts,
            ),
            present: 0,
            chained: 0,
        }
    }
}

/// The `Call`s or the `Dot`s of a file by a name: each is in exactly one group.
/// - `0..NAME_CLASSES`: by the [`name_class`] of the name of a `Dot` that is not private, which is the expression or what it calls.
/// - `FUNCTIONS..OTHERS`: a `Call` of an identifier, by the class of that, two classes to a group.
/// - `OTHERS`: everything else.
pub(crate) struct ByName {
    /// The group of each, in the order of the list of all of them (`File::exprs_of`).
    groups: Vec<u8>,
    /// Places in that list, group by group, ascending in each.
    places: Vec<u32>,
    /// Where each group that is not empty starts in `places`, and how many are in it.
    starts: [u32; ByName::GROUPS],
    counts: [u32; ByName::GROUPS],
    /// A bit for each group that is not empty.
    present: [u64; 4],
}

/// The classes of the names of a file.
struct Classes<'a> {
    file: &'a File<'a>,
    /// By the number of the name, for the names that the file numbers itself, from 0 on. `UNKNOWN`: not asked for yet.
    known: Vec<u8>,
    /// Of the other names.
    others: FxHashMap<u32, u8>,
}

impl<'a> Classes<'a> {
    const UNKNOWN: u8 = u8::MAX;

    #[inline]
    fn of(&mut self, name: Atom) -> u8 {
        match self.known.get(name.0 as usize) {
            Some(&class) if class != Classes::UNKNOWN => class,
            _ => self.learn(name),
        }
    }

    fn new(file: &'a File<'a>) -> Self {
        Classes {
            file,
            known: Vec::new(),
            others: FxHashMap::default(),
        }
    }

    #[inline(never)]
    fn learn(&mut self, name: Atom) -> u8 {
        let (file, at) = (self.file, name.0 as usize);
        let class = || name_class(file.name(name).bytes()) as u8;
        if file.texts.span_of(name).is_none() {
            return *self.others.entry(name.0).or_insert_with(class);
        }
        if self.known.len() <= at {
            self.known.resize(at + 1, Classes::UNKNOWN);
        }
        self.known[at] = class();
        self.known[at]
    }

    /// The group of the `Dot` with this name, which is written at `pos`.
    #[inline]
    fn of_member(&mut self, name: Atom, pos: u32) -> u8 {
        match self.file.text().get(pos as usize) {
            Some(b'#') => ByName::OTHERS as u8,
            _ => self.of(name),
        }
    }
}

impl ByName {
    const FUNCTIONS: usize = NAME_CLASSES;
    const OTHERS: usize = ByName::FUNCTIONS + NAME_CLASSES / 2;
    const GROUPS: usize = ByName::OTHERS + 1;

    /// `groups`: the group of each.
    fn new(groups: Vec<u8>) -> ByName {
        const { assert!(ByName::GROUPS <= 4 * 64 && NAME_CLASSES < Classes::UNKNOWN as usize) };
        let (mut counts, mut present) = ([0u32; ByName::GROUPS], [0u64; 4]);
        for &group in &groups {
            if let Some(count) = counts.get_mut(group as usize) {
                *count += 1;
                present[group as usize / 64] |= 1 << (group % 64);
            }
        }
        // A file has few of the groups: nothing is done for the others.
        let (mut starts, mut end) = ([0u32; ByName::GROUPS], 0);
        for (word, &present) in present.iter().enumerate() {
            each_bit(present, |bit| {
                starts[64 * word + bit] = end;
                end += counts[64 * word + bit];
            });
        }
        let mut next = starts;
        let mut places = vec![0u32; groups.len()];
        for (place, &group) in (0u32..).zip(&groups) {
            if let Some(at) = next.get_mut(group as usize)
                && let Some(slot) = places.get_mut(*at as usize)
            {
                *slot = place;
                *at += 1;
            }
        }
        ByName {
            groups,
            places,
            starts,
            counts,
            present,
        }
    }

    fn of_calls<'a>(file: &'a File<'a>) -> ByName {
        let (hir, mut classes) = (&file.hir, Classes::new(file));
        let group_of = |&id: &u32| {
            let callee = match hir.exprs.get(id as usize).map(|it| &it.kind) {
                Some(&hir::ExprKind::Call(call)) => hir.calls.get(call.idx()),
                _ => None,
            };
            let callee = callee.and_then(|it| hir.exprs.get(file.written_expr(it.callee).idx()));
            match callee.map(|it| &it.kind) {
                Some(&hir::ExprKind::Dot { name, name_pos, .. }) => {
                    classes.of_member(name, name_pos)
                }
                Some(&hir::ExprKind::Ident(name)) => {
                    (ByName::FUNCTIONS + classes.of(name) as usize % (NAME_CLASSES / 2)) as u8
                }
                _ => ByName::OTHERS as u8,
            }
        };
        ByName::new(file.exprs_of(ExprTag::Call).iter().map(group_of).collect())
    }

    fn of_members<'a>(file: &'a File<'a>) -> ByName {
        let mut classes = Classes::new(file);
        let group_of = |&id: &u32| match file.hir.exprs.get(id as usize).map(|it| &it.kind) {
            Some(&hir::ExprKind::Dot { name, name_pos, .. }) => classes.of_member(name, name_pos),
            _ => ByName::OTHERS as u8,
        };
        ByName::new(file.exprs_of(ExprTag::Dot).iter().map(group_of).collect())
    }

    fn has_any_of(&self, groups: [u64; 4]) -> bool {
        let both = groups.iter().zip(&self.present);
        both.fold(0, |any, (wanted, present)| any | (wanted & present)) != 0
    }

    /// Replaces `found` by those of `all`, which is what has been grouped, that are in one of `groups`, in the order of `all`.
    fn find(&self, groups: [u64; 4], all: &[u32], found: &mut Vec<u32>) {
        found.clear();
        let (mut count, mut total) = (0, 0);
        for (word, (wanted, present)) in groups.iter().zip(&self.present).enumerate() {
            each_bit(wanted & present, |bit| {
                count += 1;
                total += self.counts[64 * word + bit] as usize;
            });
        }
        // Many of them: to go through all is less than to put those in order.
        if count > 1 && 4 * total > all.len() {
            found.extend(self.those_of(groups, all));
            return;
        }
        for (word, (wanted, present)) in groups.iter().zip(&self.present).enumerate() {
            each_bit(wanted & present, |bit| {
                let (start, count) = (self.starts[64 * word + bit], self.counts[64 * word + bit]);
                let places = self.places.get(start as usize..(start + count) as usize);
                for &place in places.unwrap_or_default() {
                    found.push(place);
                }
            });
        }
        if count > 1 {
            found.sort_unstable();
        }
        for place in found.iter_mut() {
            *place = all.get(*place as usize).map_or(u32::MAX, |&id| id);
        }
        debug_assert!(self.those_of(groups, all).eq(found.iter().copied()));
    }

    /// Those of `all`, which is what has been grouped, that are in one of `groups`, by a look at the group of each.
    fn those_of(&self, groups: [u64; 4], all: &[u32]) -> impl Iterator<Item = u32> {
        let is_wanted = move |group: u8| groups[group as usize / 64] >> (group % 64) & 1 != 0;
        let wanted = all
            .iter()
            .zip(&self.groups)
            .filter(move |it| is_wanted(*it.1));
        wanted.map(|it| *it.0)
    }
}

/// The expressions, statements, types and patterns of a file by kind, each grouped the first time a rule listens for one. Left
/// out are the nodes that are not part of the tree, which the parser leaves behind where it has backtracked, and those that are
/// synthesized from JSDoc comments.
#[derive(Default)]
pub(crate) struct ByKind {
    exprs: OnceCell<Exprs>,
    stmts: OnceCell<Grouped<{ StmtTag::COUNT + 1 }>>,
    types: OnceCell<Grouped<{ TypeTag::COUNT + 1 }>>,
    pats: OnceCell<Grouped<{ PatTag::COUNT + 1 }>>,
    /// `Grouped::present` of these three, which can be known before they are grouped.
    present_stmts: OnceCell<u64>,
    present_types: OnceCell<u64>,
    present_pats: OnceCell<u64>,
    /// The `ExprTag::Binary` and the `ExprTag::Unary` by operator.
    binaries: OnceCell<Grouped<{ BinOp::Comma as usize + 2 }>>,
    unaries: OnceCell<Grouped<{ UnOp::PostDec as usize + 2 }>>,
    calls_by_name: OnceCell<Box<ByName>>,
    members_by_name: OnceCell<Box<ByName>>,
    /// The group `ByName::OTHERS` of each, for a file that is asked for nothing else.
    other_calls: OnceCell<Vec<u32>>,
    other_members: OnceCell<Vec<u32>>,
    /// A list that `File::named` has filled and that is not in use any more.
    spare: Cell<Vec<u32>>,
    fns: OnceCell<Vec<u32>>,
    classes: OnceCell<Vec<u32>>,
    members: OnceCell<Vec<u32>>,
    props: OnceCell<Vec<u32>>,
    params: OnceCell<Vec<u32>>,
    type_params: OnceCell<Vec<u32>>,
    var_decls: OnceCell<Vec<u32>>,
    cases: OnceCell<Vec<u32>>,
    enum_members: OnceCell<Vec<u32>>,
    import_specs: OnceCell<Vec<u32>>,
    export_specs: OnceCell<Vec<u32>>,
    pub(crate) nearby_line: crate::source::NearbyLine,
    pub(crate) string_literals: OnceCell<Vec<crate::literal::RawLiteral>>,
    pub(crate) number_literals: OnceCell<Vec<crate::literal::RawLiteral>>,
}

impl File<'_> {
    /// Whether the groups of the expressions are made of the kinds that the binder has noted (`Bound::expr_kinds`).
    pub(crate) fn groups_exprs_as_the_binder(&self) -> bool {
        self.bound.expr_kinds.len() == self.hir.exprs.len()
            && !self.has_synthetic_nodes()
            && self.hir.import_attributes.is_empty()
    }

    #[inline]
    pub(crate) fn by_kind(&self) -> &ByKind {
        &self.lazy.by_kind
    }

    #[inline]
    fn exprs(&self) -> &Exprs {
        self.by_kind().exprs.get_or_init(|| Exprs::new(self))
    }

    #[inline(never)]
    pub(crate) fn exprs_of(&self, tag: ExprTag) -> &[u32] {
        let grouped = &self.exprs().grouped;
        &grouped.ids[grouped.starts[2 * tag as usize] as usize
            ..grouped.starts[2 * tag as usize + 2] as usize]
    }

    /// Those of `exprs_of` that are part of an optional chain.
    #[inline(never)]
    pub(crate) fn chained_exprs_of(&self, tag: ExprTag) -> &[u32] {
        self.exprs().grouped.of(2 * tag as usize + 1)
    }

    /// What the binder has counted from `first` on, at `kind + 1` for each kind, of which there is one less than `ENDS`.
    /// `None`: it has not counted, or the file has nodes that are synthesized, which are counted and are no nodes here.
    #[inline]
    fn counted<const ENDS: usize>(&self, first: usize) -> Option<[u32; ENDS]> {
        let counted = self.bound.kind_counts.get(first..first + ENDS - 1)?;
        let mut counts = [0u32; ENDS];
        counts.get_mut(1..)?.copy_from_slice(counted);
        (!self.has_synthetic_nodes()).then_some(counts)
    }

    /// How many statements there are of each kind, if the binder has counted them and all of them are nodes: none is the head
    /// of a `for` that is an expression, the object of a `with`, or the `B` of `namespace A.B`.
    fn counted_stmts(&self) -> Option<[u32; StmtTag::COUNT + 1]> {
        let counts = self.counted(kind_counts::STMTS)?;
        let heads = *(self.bound.kind_counts).get(kind_counts::HEADS_THAT_ARE_EXPRESSIONS)?;
        (heads == 0 && self.hir.with_bodies.is_empty() && counts[StmtTag::Module as usize + 1] < 2)
            .then_some(counts)
    }

    /// The same for the types: none is an error with an operand that is no node.
    fn counted_types(&self) -> Option<[u32; TypeTag::COUNT + 1]> {
        let counts = self.counted(kind_counts::TYPES)?;
        (counts[TypeTag::JSDoc as usize + 1] == 0).then_some(counts)
    }

    /// The same for the patterns, of which those that are missing are no nodes: each is part of something.
    fn counted_pats(&self) -> Option<[u32; PatTag::COUNT + 1]> {
        let mut counts = self.counted(kind_counts::PATS)?;
        counts[PatTag::Missing as usize + 1] = 0;
        let orphans = *(self.bound.kind_counts).get(kind_counts::PATS_WITHOUT_PARENT)?;
        (orphans == 0).then_some(counts)
    }

    #[inline]
    fn stmts(&self) -> &Grouped<{ StmtTag::COUNT + 1 }> {
        self.by_kind()
            .stmts
            .get_or_init(|| match self.counted_stmts() {
                Some(counts) => {
                    let kinds = self.hir.stmts.iter().map(|it| {
                        debug_assert_eq!(StmtTag::of(&it.kind) as u8, it.kind.tag() as u8);
                        StmtTag::of(&it.kind) as u8
                    });
                    let grouped = Grouped::of_counted_kinds(0.., kinds, &counts);
                    debug_assert!(
                        grouped.is_same_as(&Grouped::new(|kinds| self.stmt_tags_in_tree(kinds)))
                    );
                    grouped
                }
                None => Grouped::new(|kinds| self.stmt_tags_in_tree(kinds)),
            })
    }

    #[inline(never)]
    fn stmts_of(&self, tag: StmtTag) -> &[u32] {
        self.stmts().of(tag as usize)
    }

    #[inline]
    fn type_nodes(&self) -> &Grouped<{ TypeTag::COUNT + 1 }> {
        let group = || match self.counted_types() {
            Some(counts) => {
                let kinds = self.hir.types.iter().map(|it| {
                    debug_assert_eq!(TypeTag::of(&it.kind) as u8, it.kind.tag() as u8);
                    TypeTag::of(&it.kind) as u8
                });
                let grouped = Grouped::of_counted_kinds(0.., kinds, &counts);
                debug_assert!(
                    grouped.is_same_as(&Grouped::new(|kinds| self.type_tags_in_tree(kinds)))
                );
                grouped
            }
            None => Grouped::new(|kinds| self.type_tags_in_tree(kinds)),
        };
        (self.by_kind().types).get_or_init(|| match self.hir.types.is_empty() {
            true => Grouped::empty(),
            false => group(),
        })
    }

    #[inline(never)]
    pub(crate) fn types_of(&self, tag: TypeTag) -> &[u32] {
        self.type_nodes().of(tag as usize)
    }

    #[inline]
    fn binaries(&self) -> &Grouped<{ BinOp::Comma as usize + 2 }> {
        self.by_kind().binaries.get_or_init(|| {
            Grouped::of_ids(
                self.exprs_of(ExprTag::Binary).iter().copied(),
                |id| match self.hir.exprs.get(id as usize)?.kind {
                    hir::ExprKind::Binary { op, .. } => Some(op as usize),
                    _ => None,
                },
            )
        })
    }

    /// `op`: a `BinOp` as a number.
    #[inline(never)]
    fn binaries_at(&self, op: usize) -> &[u32] {
        self.binaries().of(op)
    }

    #[inline]
    fn unaries(&self) -> &Grouped<{ UnOp::PostDec as usize + 2 }> {
        self.by_kind().unaries.get_or_init(|| {
            Grouped::of_ids(
                self.exprs_of(ExprTag::Unary).iter().copied(),
                |id| match self.hir.exprs.get(id as usize)?.kind {
                    hir::ExprKind::Unary { op, .. } => Some(op as usize),
                    _ => None,
                },
            )
        })
    }

    /// `op`: an `UnOp` as a number.
    #[inline(never)]
    fn unaries_at(&self, op: usize) -> &[u32] {
        self.unaries().of(op)
    }

    /// Whether the file has an expression of one of these kinds. For a rule that has nothing to do otherwise, and whose listeners
    /// are not free: those for code paths make the linter walk and analyze the whole file.
    pub fn has_exprs(&self, tags: impl IntoIterator<Item = ExprTag>) -> bool {
        tags.into_iter().any(|tag| !self.exprs_of(tag).is_empty())
    }

    /// The same for statements.
    pub fn has_stmts(&self, tags: impl IntoIterator<Item = StmtTag>) -> bool {
        tags.into_iter().any(|tag| !self.stmts_of(tag).is_empty())
    }

    /// The same for classes.
    pub fn has_classes(&self) -> bool {
        !self.hir.classes.is_empty()
    }

    #[inline]
    fn pats(&self) -> &Grouped<{ PatTag::COUNT + 1 }> {
        let group = || match self.counted_pats() {
            Some(counts) => {
                let kinds = self.hir.pats.iter().map(|it| {
                    debug_assert_eq!(PatTag::of(&it.kind) as u8, it.kind.tag() as u8);
                    match PatTag::of(&it.kind) {
                        PatTag::Missing => NOT_IN_TREE,
                        tag => tag as u8,
                    }
                });
                let grouped = Grouped::of_counted_kinds(0.., kinds, &counts);
                debug_assert!(
                    grouped.is_same_as(&Grouped::new(|kinds| self.pat_tags_in_tree(kinds)))
                );
                grouped
            }
            None => Grouped::new(|kinds| self.pat_tags_in_tree(kinds)),
        };
        (self.by_kind().pats).get_or_init(|| match self.hir.pats.is_empty() {
            true => Grouped::empty(),
            false => group(),
        })
    }

    #[inline(never)]
    pub(crate) fn pats_of(&self, tag: PatTag) -> &[u32] {
        self.pats().of(tag as usize)
    }

    /// Which of these kinds the file has: a bit for each, as in [`On`]. Not inlined: they group the nodes the first time.
    #[inline(never)]
    fn present_exprs(&self) -> u64 {
        self.exprs().present
    }

    #[inline(never)]
    fn present_chained(&self) -> u64 {
        self.exprs().chained
    }

    #[inline(never)]
    fn present_binaries(&self) -> u64 {
        self.binaries().present
    }

    #[inline(never)]
    fn present_unaries(&self) -> u64 {
        self.unaries().present
    }

    #[inline(never)]
    fn present_stmts(&self) -> u64 {
        *(self.by_kind().present_stmts).get_or_init(|| match self.counted_stmts() {
            Some(counts) => Grouped::<{ StmtTag::COUNT + 1 }>::present(&counts),
            None => self.stmts().present,
        })
    }

    #[inline(never)]
    fn present_types(&self) -> u64 {
        if self.hir.types.is_empty() {
            return 0;
        }
        *(self.by_kind().present_types).get_or_init(|| match self.counted_types() {
            Some(counts) => Grouped::<{ TypeTag::COUNT + 1 }>::present(&counts),
            None => self.type_nodes().present,
        })
    }

    #[inline(never)]
    fn present_pats(&self) -> u64 {
        if self.hir.pats.is_empty() {
            return 0;
        }
        *(self.by_kind().present_pats).get_or_init(|| match self.counted_pats() {
            Some(counts) => Grouped::<{ PatTag::COUNT + 1 }>::present(&counts),
            None => self.pats().present,
        })
    }
}

/// Declares `File::$method`, which calls a function with every `$handle` of the file that is part of the tree. Which these are
/// is found out once for all rules, by `File::$list`. `$owners`, `$no_owner`: what each is part of, by the binder, and what that
/// is for one that is part of nothing.
macro_rules! every {
    ($($method:ident $list:ident $handle:ident $field:ident $owners:expr, $no_owner:expr;)*) => {
        impl<'a> File<'a> {
            $(
                #[inline(never)]
                fn $list(&'a self) -> &'a [u32] {
                    self.by_kind().$field.get_or_init(|| {
                        let all = 0..self.hir.$field.len() as u32;
                        // In nearly every file all are. That is told without a look at each on its own.
                        if !self.has_synthetic_nodes()
                            && self.hir.import_attributes.is_empty()
                            && have_all_owners(($owners)(self), all.len(), &$no_owner)
                        {
                            debug_assert!(
                                all.clone().all(|id| <$handle as Handle>::from_raw(self, id).is_in_tree())
                            );
                            return all.collect();
                        }
                        // Nearly all are in the tree: room for all of them is made at once.
                        let mut in_tree = Vec::with_capacity(all.len());
                        in_tree.extend(all.filter(|&id| <$handle as Handle>::from_raw(self, id).is_in_tree()));
                        in_tree
                    })
                }

                #[inline]
                pub(crate) fn $method(&'a self, mut visit: impl FnMut($handle<'a>)) {
                    for &id in self.$list() {
                        visit(<$handle as Handle>::from_raw(self, id));
                    }
                }
            )*
        }
    };
}

/// Whether there are `count` of `owners`, and none is `no_owner`.
#[inline]
fn have_all_owners<T: PartialEq>(
    owners: impl ExactSizeIterator<Item = T>,
    count: usize,
    no_owner: &T,
) -> bool {
    // Not left at the first: that way several are compared at once.
    owners.len() == count && owners.fold(true, |all, it| all & (it != *no_owner))
}

every! {
    every_func funcs_in_tree Func fns
        |file: &'a File<'a>| file.bound.fns.iter().map(|it| it.owner), FnOwner::None;
    every_class classes_in_tree Class classes
        |file: &'a File<'a>| file.bound.class_owner.iter().copied(), ClassOwner::Stmt(hir::StmtId::NONE);
    every_member members_in_tree Member members
        |file: &'a File<'a>| file.bound.member_owner.iter().copied(), MemberOwner::None;
    every_prop props_in_tree Prop props
        |file: &'a File<'a>| file.bound.prop_owner.iter().copied(), hir::ExprId::NONE;
    every_param params_in_tree Param params
        |file: &'a File<'a>| file.bound.param_fn.iter().copied(), hir::FnId::NONE;
    every_type_param type_params_in_tree TypeParam type_params
        |file: &'a File<'a>| file.bound.type_param_scope.iter().map(|it| it.is_some()), false;
    every_var_decl var_decls_in_tree VarDecl var_decls
        |file: &'a File<'a>| file.bound.var_stmt.iter().copied(), hir::StmtId::NONE;
    every_case cases_in_tree Case cases
        |file: &'a File<'a>| file.bound.case_stmt.iter().copied(), hir::StmtId::NONE;
    every_enum_member enum_members_in_tree EnumMember enum_members
        |file: &'a File<'a>| file.hir.enum_members.iter().map(|_| true), false;
    every_import_spec import_specs_in_tree ImportSpec import_specs
        |file: &'a File<'a>| file.hir.import_specs.iter().map(|_| true), false;
    every_export_spec export_specs_in_tree ExportSpec export_specs
        |file: &'a File<'a>| file.hir.export_specs.iter().map(|_| true), false;
}

impl<'a> File<'a> {
    /// The expressions of a kind, in no particular order. For [`Rule::start`] to look closer than [`File::has_exprs`].
    pub fn exprs_of_kind(&'a self, tag: ExprTag) -> impl Iterator<Item = Expr<'a>> {
        self.exprs_of(tag).iter().map(|&id| grouped_expr(self, id))
    }

    /// `kind`: `Call` or `Dot`.
    fn by_name(&'a self, kind: ExprTag) -> &'a ByName {
        let made = match kind {
            ExprTag::Call => {
                (self.by_kind().calls_by_name).get_or_init(|| Box::new(ByName::of_calls(self)))
            }
            _ => {
                (self.by_kind().members_by_name).get_or_init(|| Box::new(ByName::of_members(self)))
            }
        };
        debug_assert!(
            made.those_of([0, 0, 0, 1], self.exprs_of(kind))
                .eq(self.others(kind).iter().copied())
        );
        made
    }

    /// `by_name`, if it has been made.
    #[inline]
    fn by_name_if_made(&'a self, kind: ExprTag) -> Option<&'a ByName> {
        match kind {
            ExprTag::Call => self.by_kind().calls_by_name.get().map(|it| &**it),
            _ => self.by_kind().members_by_name.get().map(|it| &**it),
        }
    }

    /// The group `ByName::OTHERS` of the `Call`s or the `Dot`s, in the order of `exprs_of`, found without grouping the rest.
    fn others(&'a self, kind: ExprTag) -> &'a [u32] {
        let text = self.text();
        let is_private = |pos: u32| text.get(pos as usize) == Some(&b'#');
        match kind {
            ExprTag::Call => self.by_kind().other_calls.get_or_init(|| {
                let is_other = |id: &u32| {
                    let callee = grouped_expr(self, *id).callee();
                    match callee.and_then(Expr::try_raw).map(|it| it.kind) {
                        Some(hir::ExprKind::Dot { name_pos, .. }) => is_private(name_pos),
                        Some(hir::ExprKind::Ident(_)) => false,
                        _ => true,
                    }
                };
                let all = self.exprs_of(ExprTag::Call).iter().copied();
                all.filter(is_other).collect()
            }),
            _ => self.by_kind().other_members.get_or_init(|| {
                if !bun_core::strings::contains_char(text, b'#') {
                    return Vec::new();
                }
                let is_other = |id: &u32| match self.hir.exprs.get(*id as usize).map(|it| it.kind) {
                    Some(hir::ExprKind::Dot { name_pos, .. }) => is_private(name_pos),
                    _ => true,
                };
                let all = self.exprs_of(ExprTag::Dot).iter().copied();
                all.filter(is_other).collect()
            }),
        }
    }

    /// Whether one of these groups of the `Call`s or the `Dot`s can have something, told without grouping them: that is left
    /// until the rule has said that it starts. `may_have_names`: the file may have a name of these groups. If not, only the group
    /// `OTHERS` of them can have something.
    #[inline(never)]
    fn may_have_named(&'a self, kind: ExprTag, groups: [u64; 4], may_have_names: bool) -> bool {
        match (self.by_name_if_made(kind), may_have_names) {
            (Some(by_name), _) => by_name.has_any_of(groups),
            (None, true) => !self.exprs_of(kind).is_empty(),
            (None, false) => !self.others(kind).is_empty(),
        }
    }

    /// The `Call`s or the `Dot`s of these groups, in the order of `exprs_of`. The list is for `spare` afterwards.
    #[inline(never)]
    fn named(&'a self, kind: ExprTag, groups: [u64; 4], may_have_names: bool) -> Vec<u32> {
        let mut found = self.by_kind().spare.take();
        let by_name = match may_have_names {
            true => Some(self.by_name(kind)),
            false => self.by_name_if_made(kind),
        };
        match by_name {
            Some(by_name) => by_name.find(groups, self.exprs_of(kind), &mut found),
            None => {
                found.clear();
                found.extend_from_slice(self.others(kind));
            }
        }
        found
    }

    /// Whether the file may have one of the names that a `Call` or a `Dot` by name of `on` can have.
    #[inline(always)]
    fn may_have_names_of(&self, on: &On) -> bool {
        (on.mentions()).is_none_or(|bits| bits.iter().any(|&bit| self.mentions_bit(u32::from(bit))))
    }

    /// The `Call`s that a rule with this `on` is called with: see [`On::method_calls`] and [`On::function_calls`]. For a rule that
    /// looks at the calls from [`Rule::start`] or [`Rule::finish`]: `file.calls_on(&On::new().method_calls(&["then"]))`.
    pub fn calls_on(&'a self, on: &On) -> impl Iterator<Item = Expr<'a>> + use<'a> {
        let (kind, groups) = (ExprTag::Call, on.groups_of_calls());
        let found = match (groups[3] != 0, on.exprs & (1 << kind as u32) != 0) {
            (true, _) => self.named(kind, groups, self.may_have_names_of(on)),
            (false, true) => self.exprs_of(kind).to_vec(),
            (false, false) => Vec::new(),
        };
        found.into_iter().map(|id| grouped_expr(self, id))
    }

    /// The same for statements.
    pub fn stmts_of_kind(&'a self, tag: StmtTag) -> impl Iterator<Item = Stmt<'a>> {
        self.stmts_of(tag)
            .iter()
            .map(|&id| Stmt::from_raw(self, id))
    }

    /// The same for types.
    pub fn types_of_kind(&'a self, tag: TypeTag) -> impl Iterator<Item = TypeNode<'a>> {
        self.types_of(tag)
            .iter()
            .map(|&id| TypeNode::from_raw(self, id))
    }

    /// The same for functions: what [`Rule::func`] is called with.
    pub fn funcs(&'a self) -> impl Iterator<Item = Func<'a>> {
        (0..self.hir.fns.len())
            .map(|i| Func::from_raw(self, i as u32))
            .filter(|it| it.is_in_tree())
    }

    /// The same for classes: what [`Rule::class`] is called with.
    pub fn classes(&'a self) -> impl Iterator<Item = Class<'a>> {
        (0..self.hir.classes.len())
            .map(|i| Class::from_raw(self, i as u32))
            .filter(|it| it.is_in_tree())
    }

    pub(crate) fn every_expr_of(&'a self, tags: &[ExprTag], mut visit: impl FnMut(Expr<'a>)) {
        for &tag in tags {
            self.exprs_of(tag)
                .iter()
                .for_each(|&id| visit(grouped_expr(self, id)));
        }
    }

    pub(crate) fn every_stmt_of(&'a self, tags: &[StmtTag], mut visit: impl FnMut(Stmt<'a>)) {
        for &tag in tags {
            self.stmts_of(tag)
                .iter()
                .for_each(|&id| visit(Stmt::from_raw(self, id)));
        }
    }

    pub(crate) fn every_type_of(&'a self, tags: &[TypeTag], mut visit: impl FnMut(TypeNode<'a>)) {
        for &tag in tags {
            self.types_of(tag)
                .iter()
                .for_each(|&id| visit(TypeNode::from_raw(self, id)));
        }
    }

    /// Calls `visit` with every node of the kinds in `tags`, sort by sort, and with its `NodeTags::index_of`.
    pub(crate) fn every_node_of(&'a self, tags: NodeTags, visit: &mut dyn FnMut(Node<'a>, u32)) {
        for tag in EXPR_TAGS {
            let kind = NodeTags::from(tag);
            if tags.intersects(kind) {
                self.exprs_of(tag)
                    .iter()
                    .for_each(|&id| visit(Node::Expr(grouped_expr(self, id)), kind.first_index()));
            }
        }
        for tag in StmtTag::ALL {
            let kind = NodeTags::from(tag);
            if tags.intersects(kind) {
                self.stmts_of(tag).iter().for_each(|&id| {
                    visit(Node::Stmt(Stmt::from_raw(self, id)), kind.first_index())
                });
            }
        }
        for tag in TypeTag::ALL {
            let kind = NodeTags::from(tag);
            if tags.intersects(kind) {
                self.types_of(tag).iter().for_each(|&id| {
                    visit(Node::Type(TypeNode::from_raw(self, id)), kind.first_index())
                });
            }
        }
        if tags.intersects(NodeTags::PAT) {
            for tag in PatTag::ALL {
                self.pats_of(tag).iter().for_each(|&id| {
                    visit(
                        Node::Pat(Pat::from_raw(self, id)),
                        NodeTags::PAT.first_index(),
                    )
                });
            }
        }
        macro_rules! sorts {
            ($($tags:ident $every:ident $variant:ident;)*) => {
                $(if tags.intersects(NodeTags::$tags) {
                    self.$every(|it| visit(Node::$variant(it), NodeTags::$tags.first_index()));
                })*
            };
        }
        sorts! {
            FUNC every_func Func;
            CLASS every_class Class;
            MEMBER every_member Member;
            PROP every_prop Prop;
            PARAM every_param Param;
            TYPE_PARAM every_type_param TypeParam;
            VAR_DECL every_var_decl VarDecl;
            CASE every_case Case;
            ENUM_MEMBER every_enum_member EnumMember;
            IMPORT_SPEC every_import_spec ImportSpec;
            EXPORT_SPEC every_export_spec ExportSpec;
            TUPLE_ELEM every_tuple_elem TupleElem;
            PAT_PROP every_pat_prop PatProp;
            PAT_ELEM every_pat_elem PatElem;
        }
        if tags.intersects(NodeTags::FILE) {
            visit(Node::File(self), NodeTags::FILE.first_index());
        }
    }

    fn every_tuple_elem(&'a self, mut visit: impl FnMut(TupleElem<'a>)) {
        for i in 0..self.hir.tuple_elems.len() {
            let it = TupleElem::from_raw(self, i as u32);
            if self.type_in_tree(it.ty().id().idx()).is_some() {
                visit(it);
            }
        }
    }

    pub(crate) fn every_pat_prop(&'a self, mut visit: impl FnMut(PatProp<'a>)) {
        for i in 0..self.hir.pat_props.len() {
            let it = PatProp::from_raw(self, i as u32);
            if self.pat_in_tree(it.value().id().idx()).is_some() {
                visit(it);
            }
        }
    }

    fn every_pat_elem(&'a self, mut visit: impl FnMut(PatElem<'a>)) {
        for i in 0..self.hir.pat_elems.len() {
            let it = PatElem::from_raw(self, i as u32);
            if it
                .pat()
                .is_none_or(|pat| self.pat_in_tree(pat.id().idx()).is_some())
            {
                visit(it);
            }
        }
    }
}

// ───────────────────────────── a rule on a file ─────────────────────────────

/// What a rule is given to start on a file.
#[doc(hidden)]
#[derive(Copy, Clone)]
pub struct Start<'a> {
    file: &'a File<'a>,
    rule: u16,
    severity: Severity,
}

/// What can be started on a file: a rule, or one of several.
pub trait Starts: Send + Sync {
    /// It at work on a file, after what takes the nodes in no particular order.
    type Run<'r, 'a: 'r>: Running<'a>
    where
        Self: 'r;

    /// Calls what takes the nodes in no particular order. `None`: nothing is left to call.
    #[doc(hidden)]
    fn start<'r, 'a: 'r>(&'r self, start: Start<'a>) -> Option<Self::Run<'r, 'a>>;
}

/// For [`rules!`](crate::rules): an arm of a `match` on the rules of a crate is a call of this.
/// `None`: nothing is left to call.
#[doc(hidden)]
#[inline(never)]
pub fn start<'r, 'a: 'r, R: Rule>(rule: &'r R, start: Start<'a>) -> Option<Box<Later<'r, 'a, R>>> {
    let file = start.file;
    if R::META.requires_types && file.types.is_none() {
        return None;
    }
    let on = R::ON.and(&rule.narrow(file));
    if !has_any_of(file, &on) {
        return None;
    }
    let mut cx = Cx {
        state: Rule::start(rule, file)?,
        base: CxBase {
            file,
            meta: &R::META,
            rule: start.rule,
            severity: start.severity,
            said_by_oxlint: OnceCell::new(),
        },
    };
    call_unordered(rule, file, &on, &mut cx);
    on.has_later().then(|| {
        Box::new(Later {
            rule,
            enter: on.enter,
            exit: on.exit,
            finishes: on.has(On::FINISH),
            cx,
        })
    })
}

/// Calls `visit` with the number of each bit that is set, from the lowest.
#[inline(always)]
pub(crate) fn each_bit(mut bits: u64, mut visit: impl FnMut(usize)) {
    while bits != 0 {
        visit(bits.trailing_zeros() as usize);
        bits &= bits - 1;
    }
}

/// Whether `file` has something that a rule with `on` is called with. Where this is inlined `on` is a constant, or a part of one.
#[inline(always)]
fn has_any_of<'a>(file: &'a File<'a>, on: &On) -> bool {
    let always = On::SYMBOLS | On::STRING_LITERALS | On::NUMBER_LITERALS;
    let mut has_any = on.has_later() || on.has(always) || !on.nodes.is_empty();
    macro_rules! kinds {
        ($($field:ident $present:ident;)*) => {
            $(has_any = has_any || on.$field != 0 && file.$present() & on.$field != 0;)*
        };
    }
    kinds! {
        exprs present_exprs;
        binaries present_binaries;
        unaries present_unaries;
        stmts present_stmts;
        types present_types;
        pats present_pats;
    }
    let (calls, members) = (on.groups_of_calls(), on.groups_of_members());
    let may_have_names = (calls[3] | members[3]) != 0 && file.may_have_names_of(on);
    has_any = has_any || calls[3] != 0 && file.may_have_named(ExprTag::Call, calls, may_have_names);
    has_any =
        has_any || members[3] != 0 && file.may_have_named(ExprTag::Dot, members, may_have_names);
    has_any = has_any || on.has(On::OPTIONAL_CHAINS) && file.present_chained() != 0;
    macro_rules! sorts {
        ($($sort:ident $field:ident;)*) => {
            // Where `on` is no constant: most have none of them.
            if on.has($(On::$sort)|*) {
                $(has_any = has_any || on.has(On::$sort) && !file.hir.$field.is_empty();)*
            }
        };
    }
    sorts! {
        FUNCS fns;
        CLASSES classes;
        MEMBERS members;
        PROPS props;
        PARAMS params;
        TYPE_PARAMS type_params;
        VAR_DECLS var_decls;
        CASES cases;
        ENUM_MEMBERS enum_members;
        IMPORT_SPECS import_specs;
        EXPORT_SPECS export_specs;
    }
    has_any
}

/// What can be part of an optional chain.
const CHAINED: [ExprTag; 3] = [ExprTag::Dot, ExprTag::Index, ExprTag::Call];

/// Calls what takes the nodes in no particular order, in the order in which [`Rule`] has the methods.
#[inline]
fn call_unordered<'a, R: Rule>(rule: &R, file: &'a File<'a>, on: &On, cx: &mut Cx<'a, R>) {
    // Those by name where all of the kind would be.
    let (calls, members) = (on.groups_of_calls(), on.groups_of_members());
    let named = (calls[3] << ExprTag::Call as u32) | (members[3] << ExprTag::Dot as u32);
    let may_have_names = named != 0 && file.may_have_names_of(on);
    each_bit(on.exprs | named, |kind| {
        let found = match named & (1 << kind) != 0 {
            true if kind == ExprTag::Call as usize => {
                Some(file.named(ExprTag::Call, calls, may_have_names))
            }
            true => Some(file.named(ExprTag::Dot, members, may_have_names)),
            false => None,
        };
        for &id in (found.as_deref()).unwrap_or_else(|| file.exprs_of(EXPR_TAGS[kind])) {
            rule.expr(grouped_expr(file, id), cx);
        }
        if let Some(found) = found {
            file.by_kind().spare.set(found);
        }
    });
    if on.has(On::OPTIONAL_CHAINS) {
        for kind in CHAINED {
            for &id in file.chained_exprs_of(kind) {
                rule.optional_chain(grouped_expr(file, id), cx);
            }
        }
    }
    each_bit(on.binaries, |op| {
        for &id in file.binaries_at(op) {
            rule.binary(grouped_expr(file, id), cx);
        }
    });
    each_bit(on.unaries, |op| {
        for &id in file.unaries_at(op) {
            rule.unary(grouped_expr(file, id), cx);
        }
    });
    each_bit(on.stmts, |kind| {
        for &id in file.stmts_of(StmtTag::ALL[kind]) {
            rule.stmt(Stmt::from_raw(file, id), cx);
        }
    });
    each_bit(on.types, |kind| {
        for &id in file.types_of(TypeTag::ALL[kind]) {
            rule.ty(TypeNode::from_raw(file, id), cx);
        }
    });
    each_bit(on.pats, |kind| {
        for &id in file.pats_of(PatTag::ALL[kind]) {
            rule.pat(Pat::from_raw(file, id), cx);
        }
    });
    macro_rules! sorts {
        ($($sort:ident $every:ident $method:ident;)*) => {
            if on.has($(On::$sort)|*) {
                $(if on.has(On::$sort) {
                    file.$every(|it| rule.$method(it, cx));
                })*
            }
        };
    }
    sorts! {
        FUNCS every_func func;
        CLASSES every_class class;
        MEMBERS every_member member;
        PROPS every_prop prop;
        PARAMS every_param param;
        TYPE_PARAMS every_type_param type_param;
        VAR_DECLS every_var_decl var_decl;
        CASES every_case case;
        ENUM_MEMBERS every_enum_member enum_member;
        IMPORT_SPECS every_import_spec import_spec;
        EXPORT_SPECS every_export_spec export_spec;
    }
    if on.has(On::SYMBOLS) {
        for symbol in file.symbols() {
            rule.symbol(symbol, cx);
        }
    }
    if on.has(On::STRING_LITERALS) {
        file.every_string_literal(|it| rule.string_literal(it, cx));
    }
    if on.has(On::NUMBER_LITERALS) {
        file.every_number_literal(|it| rule.number_literal(it, cx));
    }
    if !on.nodes.is_empty() {
        for node in nodes_of(file, on.nodes) {
            rule.node(node, cx);
        }
    }
}

/// A rule at work on a file, after `call_unordered`.
#[doc(hidden)]
pub struct Later<'r, 'a, R: Rule> {
    rule: &'r R,
    /// What is left to call of `R::ON`.
    enter: NodeTags,
    exit: NodeTags,
    finishes: bool,
    cx: Cx<'a, R>,
}

impl<'a, R: Rule> Running<'a> for Later<'_, 'a, R> {
    #[inline]
    fn walks(&self) -> (NodeTags, NodeTags) {
        (self.enter, self.exit)
    }

    #[inline]
    fn enter(&mut self, node: Node<'a>) {
        self.rule.enter(node, &mut self.cx);
    }

    #[inline]
    fn exit(&mut self, node: Node<'a>) {
        self.rule.exit(node, &mut self.cx);
    }

    fn finish(&mut self) {
        if self.finishes {
            self.rule.finish(&mut self.cx);
        }
    }
}

/// How a rule is found by its name. It is handed around as a `&'static RuleEntry`, never copied.
pub struct RuleEntry {
    pub meta: &'static Meta,
}

impl RuleEntry {
    pub const fn of<R: Rule>() -> RuleEntry {
        RuleEntry { meta: &R::META }
    }
}

#[inline(never)]
fn nodes_of<'a>(file: &'a File<'a>, tags: NodeTags) -> Vec<Node<'a>> {
    let mut all = Vec::new();
    file.every_node_of(tags, &mut |node, _| all.push(node));
    all
}

/// A rule at work on a file.
#[doc(hidden)]
pub trait Running<'a> {
    /// The kinds of nodes that it is to [enter](Running::enter), and those that it is to [leave](Running::exit).
    fn walks(&self) -> (NodeTags, NodeTags);
    fn enter(&mut self, node: Node<'a>);
    fn exit(&mut self, node: Node<'a>);
    fn finish(&mut self);
}

// ───────────────────────────── the walk ─────────────────────────────

/// The rules that listen for each kind of node.
#[derive(Default)]
struct ByTag {
    /// In the order of the rules.
    registered: Vec<(NodeTags, u16)>,
    /// By `NodeTags::index_of`: where those for the kind start in `listeners`. One more than there are kinds.
    starts: Vec<u16>,
    listeners: Vec<u16>,
    tags: NodeTags,
}

impl ByTag {
    fn finish(&mut self) {
        self.starts = vec![0; NodeTags::COUNT + 1];
        for &(tags, ..) in &self.registered {
            self.tags = self.tags | tags;
            tags.indices()
                .for_each(|index| self.starts[index as usize + 1] += 1);
        }
        for index in 0..NodeTags::COUNT {
            self.starts[index + 1] += self.starts[index];
        }
        let mut next = self.starts.clone();
        self.listeners = vec![0; self.starts[NodeTags::COUNT] as usize];
        for &(tags, rule) in &self.registered {
            for index in tags.indices() {
                self.listeners[next[index as usize] as usize] = rule;
                next[index as usize] += 1;
            }
        }
    }

    /// `kind`: `NodeTags::index_of` a node.
    #[inline]
    fn of(&self, kind: u8) -> &[u16] {
        let index = kind as usize;
        &self.listeners[self.starts[index] as usize..self.starts[index + 1] as usize]
    }
}

/// Calls the listeners that depend on the order of the nodes. `MIXED`: see [`run_rules`].
struct Walk<'w, T, const MIXED: bool> {
    running: &'w mut [T],
    /// For each of `running`, if `MIXED`: it sees the scopes of typescript-eslint.
    of_eslint: &'w [bool],
    enter: ByTag,
    exit: ByTag,
}

impl<T, const MIXED: bool> Walk<'_, T, MIXED> {
    /// `kind`, here and below: `NodeTags::index_of(node)`.
    #[inline]
    fn enter<'a>(&mut self, node: Node<'a>, kind: u8)
    where
        T: Running<'a>,
    {
        for &rule in self.enter.of(kind) {
            if MIXED {
                node.file()
                    .ask_scopes_of_eslint(self.of_eslint[rule as usize]);
            }
            self.running[rule as usize].enter(node);
        }
    }

    #[inline]
    fn exit<'a>(&mut self, node: Node<'a>, kind: u8)
    where
        T: Running<'a>,
    {
        for &rule in self.exit.of(kind) {
            if MIXED {
                node.file()
                    .ask_scopes_of_eslint(self.of_eslint[rule as usize]);
            }
            self.running[rule as usize].exit(node);
        }
    }
}

/// Ranges that nest in the order of a walk: by the start, of two that start together the one that ends later first, then by the
/// rank, then by the place in the list. Returned is the place of each, in the low 32 bits.
///
/// `starts`: where each starts. `rest`: where the one at a place ends, and its rank. Few start together, so the numbers that
/// are sorted have the start and the place, and only those few are asked for the rest.
pub(crate) fn in_walk_order(
    starts: impl Iterator<Item = u32>,
    rest: &dyn Fn(u32) -> (u32, u8),
) -> Vec<u64> {
    let mut order: Vec<u64> = starts
        .zip(0u64..)
        .map(|(start, place)| u64::from(start) << 32 | place)
        .collect();
    order.sort();
    let mut together: Vec<u128> = Vec::new();
    let (mut first, mut previous) = (0, u64::MAX);
    for at in 0..=order.len() {
        let start = order.get(at).map_or(u64::MAX, |key| key >> 32);
        if start == previous {
            continue;
        }
        if at - first > 1
            && let Some(run) = order.get_mut(first..at)
        {
            together.clear();
            together.extend(run.iter().map(|&key| {
                let (end, rank) = rest(key as u32);
                Span::new(0, end).sort_key(u16::from(rank), key as u32 as usize)
            }));
            together.sort();
            for (key, sorted) in run.iter_mut().zip(&together) {
                *key = previous << 32 | u64::from(*sorted as u32);
            }
        }
        (first, previous) = (at, start);
    }
    debug_assert!(order.is_sorted_by_key(|&key| {
        let (end, rank) = rest(key as u32);
        Span::new((key >> 32) as u32, end).sort_key(u16::from(rank), key as u32 as usize)
    }));
    order
}

/// Enters and leaves the nodes that are listened for, without walking: the nodes of a file nest, so their spans determine the order.
/// Only the nodes of the kinds that are listened for are collected, from the vectors they are in, and sorted. The cost depends on
/// how many of those there are, not on the size of the file.
fn walk_listened<'a, T: Running<'a>, const MIXED: bool>(
    file: &'a File<'a>,
    walk: &mut Walk<'_, T, MIXED>,
) {
    struct Found<'a> {
        start: u32,
        end: u32,
        /// Of two nodes with the same span, the one with the lower rank contains the other.
        rank: u8,
        /// `NodeTags::index_of(node)`
        kind: u8,
        node: Node<'a>,
    }
    fn rank(node: Node) -> u8 {
        match node {
            Node::File(_) => 0,
            Node::Stmt(_) => 1,
            Node::Case(_) => 2,
            Node::Member(_) => 3,
            Node::Prop(_) => 4,
            Node::VarDecl(_) => 5,
            Node::Param(_) => 6,
            Node::PatProp(_) => 7,
            Node::PatElem(_) => 8,
            Node::EnumMember(_) => 9,
            Node::ImportSpec(_) => 10,
            Node::ExportSpec(_) => 11,
            Node::TypeParam(_) => 12,
            Node::TupleElem(_) => 13,
            Node::Type(_) => 14,
            Node::Expr(_) => 15,
            Node::Class(_) => 16,
            Node::Func(_) => 17,
            Node::Pat(_) => 18,
        }
    }
    let mut found: Vec<Found<'a>> = Vec::new();
    file.every_node_of(walk.enter.tags | walk.exit.tags, &mut |node, kind| {
        let span = node.span();
        found.push(Found {
            start: span.start,
            end: span.end,
            rank: rank(node),
            kind: kind as u8,
            node,
        });
    });
    let order = in_walk_order(found.iter().map(|it| it.start), &|at| {
        found
            .get(at as usize)
            .map_or((0, 0), |it| (it.end, it.rank))
    });

    // The nodes that have been entered and not left, each with its end and its kind.
    let mut open: Vec<(u32, u8, Node<'a>)> = Vec::new();
    for it in order
        .iter()
        .filter_map(|&key| found.get(key as u32 as usize))
    {
        while let Some(&(end, kind, node)) = open.last()
            && end <= it.start
            && !matches!(node, Node::File(_))
        {
            open.pop();
            walk.exit(node, kind);
        }
        walk.enter(it.node, it.kind);
        open.push((it.end, it.kind, it.node));
    }
    while let Some((_, kind, node)) = open.pop() {
        walk.exit(node, kind);
    }
}

pub(crate) const EXPR_TAGS: [ExprTag; ExprTag::COUNT] = {
    use ExprTag::*;
    [
        Missing,
        Ident,
        PrivateIdentifier,
        This,
        Super,
        Null,
        True,
        False,
        Number,
        String,
        BigInt,
        Regex,
        Template,
        TaggedTemplate,
        Array,
        Object,
        Fn,
        Class,
        Dot,
        Index,
        Call,
        New,
        Unary,
        Binary,
        Assign,
        Cond,
        Spread,
        Await,
        Yield,
        As,
        Satisfies,
        AsConst,
        NonNull,
        Instantiation,
        Jsx,
        ImportCall,
        ImportMeta,
        NewTarget,
    ]
};

// ───────────────────────────── a file ─────────────────────────────

/// A rule that is enabled for a file.
pub struct Enabled<'r, S: Starts> {
    pub rule: &'r S,
    pub severity: Severity,
    /// For whoever enables it: where it has the rule.
    pub place: u32,
}

impl<S: Starts> Clone for Enabled<'_, S> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<S: Starts> Copy for Enabled<'_, S> {}

/// Runs `rules` on `file`. Returns what they report, in no order: see [`sorted`]. `Diagnostic::rule` is an index into `rules`.
///
/// `wants_fixes`: whether the fixes and suggestions are going to be read.
pub(crate) fn run<'a, S: RuleSet>(
    file: &'a File<'a>,
    rules: &[Enabled<'_, S>],
    wants_fixes: bool,
) -> Vec<Diagnostic> {
    file.sink.wants_fixes.set(wants_fixes);
    file.sink.thrown.take();
    match file.language().rules_that_oxlint_lacks.is_empty() {
        true => run_rules::<S, false>(file, rules),
        false => run_rules::<S, true>(file, rules),
    }
    file.sink.diagnostics.take()
}

/// The places in `diagnostics` in the order of the positions.
///
/// `when`: for a tool that runs its rules in another way than ESLint, for each of the rules, in place of what the rule and its
/// reports say. Empty: as they say.
pub(crate) fn sorted(diagnostics: &[Diagnostic], when: &[When]) -> Vec<u32> {
    // ESLint sorts by line and column alone, which leaves what starts at the same place in the order it was reported: for a
    // listener that is called on entering a node, the outer node first; then, for one that is called on leaving, the inner;
    // then what is reported when the program ends, rule by rule. 51 bits.
    let within_start = |it: &Diagnostic| {
        // The node is what is reported unless the report names another. One that starts earlier is entered before all that
        // start here, and left after them.
        let named = it.details.as_deref().and_then(|it| it.listened_on);
        let node = named.filter(|_| when.is_empty()).unwrap_or(it.span);
        let is_outer = u64::from(node.start < it.span.start);
        let (end, rule) = (u64::from(node.end), u64::from(it.rule));
        // There are fewer than 1 << 15 rules.
        let longer_first = ((u64::from(u32::MAX) - end) << 16) | rule;
        match when.get(it.rule as usize).copied().unwrap_or(it.when) {
            When::Once => rule << 32,
            When::Entering => ((2 - is_outer) << 48) | longer_first,
            When::EnteringBySelector => (2 << 48) | longer_first | (1 << 15),
            When::EnteringShorterFirst => (2 << 48) | (end << 16) | rule,
            When::Leaving => ((3 + is_outer) << 48) | (end << 16) | rule,
            When::LeavingCodePath => (3 << 48) | (end << 16) | (1 << 15) | rule,
            When::AtTheEnd => (5 << 48) | (rule << 32) | end,
            When::Last => (6 << 48) | longer_first,
        }
    };
    // Where each starts. Its place in the list is the low 32 bits.
    let starts = diagnostics.iter().zip(0u64..);
    let mut order: Vec<u64> = starts
        .map(|(it, at)| (u64::from(it.span.start) << 32) | at)
        .collect();
    order.sort_unstable();
    let mut at_one_start: Vec<u128> = Vec::new();
    for places in order.chunk_by_mut(|a, b| a >> 32 == b >> 32) {
        if places.len() < 2 {
            continue;
        }
        at_one_start.clear();
        at_one_start.extend(places.iter().filter_map(|&place| {
            let it = diagnostics.get(place as u32 as usize)?;
            Some((u128::from(within_start(it)) << 32) | u128::from(place as u32))
        }));
        at_one_start.sort();
        for (place, sorted) in places.iter_mut().zip(&at_one_start) {
            *place = u64::from(*sorted as u32);
        }
    }
    order.into_iter().map(|place| place as u32).collect()
}

/// A bit for each of [`On::ROWS`].
type Rows = [u64; On::ROWS.div_ceil(64)];

/// Those of [`On::ROWS`] for which `file` has something. `wants(sort)`: whether a row of `On::KINDS[sort]` matters: what groups
/// the nodes of a sort is called only then. `wants_chains`: the same for the row of the optional chains.
#[inline]
fn rows_of<'a>(file: &'a File<'a>, wants: impl Fn(usize) -> bool, wants_chains: bool) -> Rows {
    let mut rows: Rows = [0; _];
    // `bits`: of the rows from `first` on.
    let mut add = |first: usize, bits: u64| {
        rows[first / 64] |= bits << (first % 64);
        if !first.is_multiple_of(64) && first / 64 + 1 < rows.len() {
            rows[first / 64 + 1] |= bits >> (64 - first % 64);
        }
    };
    add(On::ALWAYS, 1);
    macro_rules! kinds {
        ($($sort:literal $present:ident;)*) => {
            $(if wants($sort) {
                add(On::KINDS[$sort].0, file.$present());
            })*
        };
    }
    kinds! {
        0 present_exprs;
        1 present_binaries;
        2 present_unaries;
        3 present_stmts;
        4 present_types;
        5 present_pats;
    }
    add(
        On::SORTS,
        u64::from(wants_chains && file.present_chained() != 0),
    );
    // After `optional_chains`, in the order of the bits of `On`.
    macro_rules! sorts {
        ($($bit:literal $field:ident;)*) => {
            $(add(On::SORTS + $bit, u64::from(!file.hir.$field.is_empty()));)*
        };
    }
    sorts! {
        1 fns;
        2 classes;
        3 members;
        4 props;
        5 params;
        6 type_params;
        7 var_decls;
        8 cases;
        9 enum_members;
        10 import_specs;
        11 export_specs;
    }
    rows
}

/// Calls `visit` with the number of each of `rows`.
#[inline(always)]
fn each_row(rows: &Rows, mut visit: impl FnMut(usize)) {
    for (word, &bits) in rows.iter().enumerate() {
        each_bit(bits, |bit| visit(64 * word + bit));
    }
}

/// Those of `enabled` for which `file` has something: all others would not be started.
pub fn listening<'a, S: RuleSet>(file: &'a File<'a>, enabled: &RuleBits) -> RuleBits {
    let mut all = RuleBits::EMPTY;
    if *enabled == all {
        return all;
    }
    // All the words of a row, whichever have a rule that is enabled: how many there are is a constant, so there is no loop.
    let is_wanted = |row: &RuleBits| {
        let both = enabled.0.iter().zip(&row.0);
        both.fold(0, |any, (a, b)| any | (a & b)) != 0
    };
    let rows = rows_of(
        file,
        |sort| is_wanted(&S::LISTENS_TO_KINDS[sort]),
        is_wanted(&S::LISTENS[On::SORTS]),
    );
    each_row(&rows, |row| {
        if let Some(row) = S::LISTENS.get(row) {
            for (to, from) in all.0.iter_mut().zip(&row.0) {
                *to |= from;
            }
        }
    });
    for (to, from) in all.0.iter_mut().zip(&enabled.0) {
        *to &= from;
    }
    all
}

/// [`RuleSet::LISTENS`] for the rules of a configuration: in a row a rule is the bit of its place among them, so a row is as
/// long as they are many, and what is found is in their order.
#[derive(Clone)]
pub(crate) struct Listeners {
    /// How many words a row has.
    words: usize,
    /// Row after row.
    rows: Box<[u64]>,
    /// For each of `On::KINDS`: a row of it has a rule.
    wants: [bool; On::KINDS.len()],
    wants_chains: bool,
}

/// A set of places.
pub(crate) type Places = SmallVec<[u64; 16]>;

impl Listeners {
    /// `numbers`: those of the rules in `S`, in their order. One can be there several times.
    pub(crate) fn new<S: RuleSet>(numbers: &[u16]) -> Listeners {
        let words = numbers.len().div_ceil(64);
        // The last place of each number, and for each place the one before it with the same number.
        let (mut last, mut before) = (vec![None; NUMBERS], vec![None; numbers.len()]);
        let mut on = RuleBits::EMPTY;
        for (place, &number) in numbers.iter().enumerate() {
            if let Some(last) = last.get_mut(number as usize) {
                before[place] = last.replace(place);
                on.insert(number);
            }
        }
        let mut rows = vec![0u64; words * On::ROWS].into_boxed_slice();
        for (row, of_all) in S::LISTENS.iter().enumerate() {
            for (word, (listening, on)) in of_all.0.iter().zip(&on.0).enumerate() {
                each_bit(listening & on, |bit| {
                    let mut next = last[64 * word + bit];
                    while let Some(place) = next {
                        rows[row * words + place / 64] |= 1 << (place % 64);
                        next = before[place];
                    }
                });
            }
        }
        let has_any =
            |first: usize, end: usize| rows[first * words..end * words].iter().any(|&it| it != 0);
        Listeners {
            words,
            wants: On::KINDS.map(|(first, end)| has_any(first, end)),
            wants_chains: has_any(On::SORTS, On::SORTS + 1),
            rows,
        }
    }

    /// The places of those for which `file` has something: all others would not be started.
    pub(crate) fn of<'a>(&self, file: &'a File<'a>) -> Places {
        if self.words == 0 {
            return Places::new();
        }
        let rows = rows_of(file, |sort| self.wants[sort], self.wants_chains);
        match self.words {
            1 => self.joined::<1>(&rows),
            2 => self.joined::<2>(&rows),
            3 => self.joined::<3>(&rows),
            4 => self.joined::<4>(&rows),
            words => {
                let mut all = Places::from_elem(0, words);
                each_row(&rows, |row| {
                    let row = self.rows.get(row * words..(row + 1) * words);
                    for (to, from) in all.iter_mut().zip(row.unwrap_or_default()) {
                        *to |= from;
                    }
                });
                all
            }
        }
    }

    /// `rows` of them joined, where a row has `WORDS` words.
    fn joined<const WORDS: usize>(&self, rows: &Rows) -> Places {
        let (all_rows, _) = self.rows.as_chunks::<WORDS>();
        let mut all = [0; WORDS];
        each_row(rows, |row| {
            if let Some(row) = all_rows.get(row) {
                for (to, from) in all.iter_mut().zip(row) {
                    *to |= from;
                }
            }
        });
        Places::from_slice(&all)
    }
}

/// `MIXED`: with a configuration of oxlint, some of the rules are rules that oxlint lacks. They see the scopes of
/// typescript-eslint, and the others those of oxc: before a rule is called the file is told [which](File::ask_scopes_of_eslint).
fn run_rules<'r, 'a: 'r, S: RuleSet, const MIXED: bool>(
    file: &'a File<'a>,
    rules: &'r [Enabled<'r, S>],
) {
    let mut running: Vec<S::Run<'r, 'a>> = Vec::with_capacity(rules.len());
    let mut of_eslint: Vec<bool> = Vec::new();
    let is_lacking = |rule: &S| {
        let lacking = &file.language().rules_that_oxlint_lacks;
        let meta = S::METAS.get(rule.number() as usize).copied().flatten();
        meta.is_some_and(|meta| {
            (lacking.iter()).any(|it| it.plugin == meta.plugin && it.name == meta.name)
        })
    };
    for (i, enabled) in rules.iter().enumerate() {
        if enabled.severity == Severity::Off {
            continue;
        }
        let asks_eslint = MIXED && is_lacking(enabled.rule);
        if MIXED {
            file.ask_scopes_of_eslint(asks_eslint);
        }
        let run = enabled.rule.start(Start {
            file,
            rule: i as u16,
            severity: enabled.severity,
        });
        if let Some(run) = run {
            running.push(run);
            if MIXED {
                of_eslint.push(asks_eslint);
            }
        }
    }

    let (mut enter, mut exit) = (ByTag::default(), ByTag::default());
    for (i, rule) in running.iter().enumerate() {
        let (entered, left) = rule.walks();
        if !entered.is_empty() {
            enter.registered.push((entered, i as u16));
        }
        if !left.is_empty() {
            exit.registered.push((left, i as u16));
        }
    }
    if !enter.registered.is_empty() || !exit.registered.is_empty() {
        enter.finish();
        exit.finish();
        let mut listeners = Walk::<_, MIXED> {
            running: &mut running,
            of_eslint: &of_eslint,
            enter,
            exit,
        };
        walk_listened(file, &mut listeners);
    }

    for (i, rule) in running.iter_mut().enumerate() {
        if MIXED {
            file.ask_scopes_of_eslint(of_eslint[i]);
        }
        rule.finish();
    }
    if MIXED {
        file.ask_scopes_of_eslint(false);
    }
}

/// Declares the rules of a crate: one module in `rules/` for each, and the list of all of them. `b::Rule = a<true>` is a
/// rule without a module of its own: `a::Rule<true>`.
#[macro_export]
macro_rules! rules {
    ($($module:ident::$rule:ident $(= $of:ident<$($argument:literal),+>)?,)*) => {
        pub mod rules {
            $($crate::rule_module! { $module::$rule $(= $of<$($argument),+>)? })*
        }

        /// Sorted by name.
        pub static RULES: &[$crate::runner::RuleEntry] = &[
            $($crate::runner::RuleEntry::of::<rules::$module::$rule>(),)*
        ];

        $crate::rules_as_a_set! { $($module::$rule,)* }
    };
}

/// For [`rules!`](crate::rules).
#[doc(hidden)]
#[macro_export]
macro_rules! rule_module {
    ($module:ident::$rule:ident) => {
        pub mod $module;
    };
    ($module:ident::$rule:ident = $of:ident<$($argument:literal),+>) => {
        pub mod $module {
            pub type $rule = super::$of::$rule<$($argument),+>;
        }
    };
}
