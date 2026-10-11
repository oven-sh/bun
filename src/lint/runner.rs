//! Runs rules on a file.

use crate::ast::{
    BinOp, Case, Chain, Class, EnumMember, ExportSpec, Expr, ExprTag, File, Func, Handle,
    ImportSpec, Member, NOT_IN_TREE, Node, Param, Pat, PatElem, PatProp, PatTag, Prop, Stmt,
    StmtTag, TupleElem, TypeNode, TypeParam, TypeTag, UnOp, VarDecl,
};
use crate::context::{Cx, CxBase, Diagnostic, Severity};
use crate::rule::{Meta, NAME_CLASSES, NodeTags, On, Rule, When, name_class};
use crate::rule_set::{RuleBits, RuleSet};
use crate::span::Span;
use bun_sema::atom::Atom;
use bun_sema::bind::kind_counts;
use bun_sema::hir;
use std::cell::{Cell, OnceCell};

// ───────────────────────────── the nodes of a file, by kind ─────────────────────────────

/// Indices into one vector of the HIR, grouped by the kind of the node.
pub(crate) struct Grouped<const KINDS: usize> {
    ids: Vec<u32>,
    /// Where each kind starts in `ids`, and where the last ends.
    starts: [u32; MOST_KINDS + 2],
    /// A bit for each kind of which there is a node, if there are no more than 64 kinds.
    present: u64,
}

const MOST_KINDS: usize = 2 * ExprTag::COUNT;
const _: () = assert!(MOST_KINDS < NOT_IN_TREE as usize);

/// At `kind + 1`: how many of `kinds` are `kind`.
fn count_kinds(kinds: &[u8]) -> [u32; MOST_KINDS + 2] {
    // A place for each number that there can be: nothing is asked for each of `kinds`.
    let mut of_all = [0u32; u8::MAX as usize + 2];
    for &kind in kinds {
        of_all[kind as usize + 1] += 1;
    }
    let mut counts = [0u32; MOST_KINDS + 2];
    counts.copy_from_slice(&of_all[..MOST_KINDS + 2]);
    counts
}

impl<const KINDS: usize> Grouped<KINDS> {
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
        let kinds: Vec<u8> = all
            .clone()
            .map(|id| kind_of(id).map_or(NOT_IN_TREE, |kind| kind as u8))
            .collect();
        Grouped::of_kinds(all, &kinds)
    }

    /// `kinds`: the kind of each of `all`, `NOT_IN_TREE` to leave it out.
    fn of_kinds(all: impl Iterator<Item = u32>, kinds: &[u8]) -> Self {
        Grouped::of_counted_kinds(all, kinds.iter().copied(), &count_kinds(kinds))
    }

    /// A bit for each kind of which there is one, if there are no more than 64 kinds. `counts`: as below.
    fn present(counts: &[u32; MOST_KINDS + 2]) -> u64 {
        let kinds = 0..KINDS.min(64);
        kinds.fold(0, |present, kind| {
            present | u64::from(counts[kind + 1] != 0) << kind
        })
    }

    /// `counts`: at `kind + 1`, how many of `kinds` are `kind`.
    fn of_counted_kinds(
        all: impl Iterator<Item = u32>,
        kinds: impl Iterator<Item = u8>,
        counts: &[u32; MOST_KINDS + 2],
    ) -> Self {
        const { assert!(KINDS <= MOST_KINDS) };
        let (mut starts, present) = (*counts, Self::present(counts));
        for kind in 0..KINDS {
            starts[kind + 1] += starts[kind];
        }
        // Where the next of each kind goes. What is left out has no place.
        let mut next = [u32::MAX; u8::MAX as usize + 1];
        next[..KINDS].copy_from_slice(&starts[..KINDS]);
        let mut ids = vec![0u32; starts[KINDS] as usize];
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

    #[inline]
    fn of(&self, kind: usize) -> &[u32] {
        &self.ids[self.starts[kind] as usize..self.starts[kind + 1] as usize]
    }
}

/// The expressions of a file.
struct Exprs {
    /// Each kind in two parts: first what is not part of an optional chain, then what is.
    grouped: Grouped<{ 2 * ExprTag::COUNT }>,
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
        if kinds.len() != file.hir.exprs.len()
            || file.has_synthetic_nodes()
            || !file.hir.import_attributes.is_empty()
        {
            return None;
        }
        let mut counts = [0u32; MOST_KINDS + 2];
        counts.get_mut(1..=counted.len())?.copy_from_slice(counted);
        let mut grouped: Grouped<{ 2 * ExprTag::COUNT }> =
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
        let (mut kinds, mut counts) = (Vec::new(), [0u32; MOST_KINDS + 2]);
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
    /// Places in the list of all of them (`File::exprs_of`), group by group, ascending in each.
    places: Vec<u32>,
    /// Where each group starts in `places`, and where the last ends.
    starts: [u32; ByName::GROUPS + 1],
    /// A bit for each group that is not empty.
    present: [u64; 4],
}

/// The classes of the names that were asked for last, each at the place that the number of the name tells: the number, then 8
/// bits for the class.
struct Classes<'a> {
    file: &'a File<'a>,
    known: [u64; 256],
}

impl<'a> Classes<'a> {
    fn new(file: &'a File<'a>) -> Self {
        Classes {
            file,
            known: [u64::MAX; 256],
        }
    }

    #[inline]
    fn of(&mut self, name: Atom) -> u8 {
        let known = &mut self.known[name.0 as usize % 256];
        if *known >> 8 != u64::from(name.0) {
            let class = name_class(self.file.name(name).bytes());
            *known = u64::from(name.0) << 8 | class as u64;
        }
        *known as u8
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

    /// `group_of`: the group of each of `all`.
    fn new(all: &[u32], mut group_of: impl FnMut(u32) -> u8) -> ByName {
        const { assert!(ByName::GROUPS <= 4 * 64) };
        let mut counts = [0u32; u8::MAX as usize + 2];
        let groups: Vec<u8> = (all.iter())
            .map(|&id| {
                let group = group_of(id);
                counts[group as usize + 1] += 1;
                group
            })
            .collect();
        let (mut starts, mut present) = ([0u32; ByName::GROUPS + 1], [0u64; 4]);
        for group in 0..ByName::GROUPS {
            present[group / 64] |= u64::from(counts[group + 1] != 0) << (group % 64);
            starts[group + 1] = starts[group] + counts[group + 1];
        }
        let mut next = [u32::MAX; u8::MAX as usize + 1];
        next[..ByName::GROUPS].copy_from_slice(&starts[..ByName::GROUPS]);
        let mut places = vec![0u32; starts[ByName::GROUPS] as usize];
        for (place, &group) in (0u32..).zip(&groups) {
            let at = &mut next[group as usize];
            if let Some(slot) = places.get_mut(*at as usize) {
                *slot = place;
                *at += 1;
            }
        }
        ByName {
            places,
            starts,
            present,
        }
    }

    fn of_calls<'a>(file: &'a File<'a>) -> ByName {
        let mut classes = Classes::new(file);
        ByName::new(file.exprs_of(ExprTag::Call), |id| {
            let callee = grouped_expr(file, id).callee();
            match callee.and_then(Expr::try_raw).map(|it| it.kind) {
                Some(hir::ExprKind::Dot { name, name_pos, .. }) => {
                    classes.of_member(name, name_pos)
                }
                Some(hir::ExprKind::Ident(name)) => {
                    (ByName::FUNCTIONS + classes.of(name) as usize % (NAME_CLASSES / 2)) as u8
                }
                _ => ByName::OTHERS as u8,
            }
        })
    }

    fn of_members<'a>(file: &'a File<'a>) -> ByName {
        let mut classes = Classes::new(file);
        ByName::new(file.exprs_of(ExprTag::Dot), |id| {
            match file.hir.exprs.get(id as usize).map(|it| it.kind) {
                Some(hir::ExprKind::Dot { name, name_pos, .. }) => {
                    classes.of_member(name, name_pos)
                }
                _ => ByName::OTHERS as u8,
            }
        })
    }

    fn has_any_of(&self, groups: [u64; 4]) -> bool {
        let both = groups.iter().zip(&self.present);
        both.fold(0, |any, (wanted, present)| any | (wanted & present)) != 0
    }

    /// Replaces `found` by those of `all`, which is what has been grouped, that are in one of `groups`, in the order of `all`.
    fn find(&self, groups: [u64; 4], all: &[u32], found: &mut Vec<u32>) {
        found.clear();
        let mut count = 0;
        for (word, (wanted, present)) in groups.iter().zip(&self.present).enumerate() {
            each_bit(wanted & present, |bit| {
                let group = 64 * word + bit;
                let places = self.starts[group] as usize..self.starts[group + 1] as usize;
                found.extend_from_slice(&self.places[places]);
                count += 1;
            });
        }
        if count > 1 {
            found.sort_unstable();
        }
        for place in found {
            *place = all.get(*place as usize).map_or(u32::MAX, |&id| id);
        }
    }
}

/// The expressions, statements, types and patterns of a file by kind, each grouped the first time a rule listens for one. Left
/// out are the nodes that are not part of the tree, which the parser leaves behind where it has backtracked, and those that are
/// synthesized from JSDoc comments.
#[derive(Default)]
pub(crate) struct ByKind {
    exprs: OnceCell<Exprs>,
    stmts: OnceCell<Grouped<{ StmtTag::COUNT }>>,
    types: OnceCell<Grouped<{ TypeTag::COUNT }>>,
    pats: OnceCell<Grouped<{ PatTag::COUNT }>>,
    /// `Grouped::present` of these three, which can be known before they are grouped.
    present_stmts: OnceCell<u64>,
    present_types: OnceCell<u64>,
    present_pats: OnceCell<u64>,
    /// The `ExprTag::Binary` and the `ExprTag::Unary` by operator.
    binaries: OnceCell<Grouped<{ BinOp::Comma as usize + 1 }>>,
    unaries: OnceCell<Grouped<{ UnOp::PostDec as usize + 1 }>>,
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
    #[inline]
    pub(crate) fn by_kind(&self) -> &ByKind {
        self.lazy.by_kind.get_or_init(ByKind::default)
    }

    #[inline]
    fn exprs(&self) -> &Exprs {
        self.by_kind().exprs.get_or_init(|| Exprs::new(self))
    }

    #[inline(never)]
    fn exprs_of(&self, tag: ExprTag) -> &[u32] {
        let grouped = &self.exprs().grouped;
        &grouped.ids[grouped.starts[2 * tag as usize] as usize
            ..grouped.starts[2 * tag as usize + 2] as usize]
    }

    /// Those of `exprs_of` that are part of an optional chain.
    #[inline(never)]
    pub(crate) fn chained_exprs_of(&self, tag: ExprTag) -> &[u32] {
        self.exprs().grouped.of(2 * tag as usize + 1)
    }

    /// What the binder has counted from `first` on, at `kind + 1` for each of `kinds` kinds. `None`: it has not counted, or the
    /// file has nodes that are synthesized, which are counted and are no nodes here.
    fn counted(&self, first: usize, kinds: usize) -> Option<[u32; MOST_KINDS + 2]> {
        let counted = self.bound.kind_counts.get(first..first + kinds)?;
        let mut counts = [0u32; MOST_KINDS + 2];
        counts.get_mut(1..=kinds)?.copy_from_slice(counted);
        (!self.has_synthetic_nodes()).then_some(counts)
    }

    /// How many statements there are of each kind, if the binder has counted them and all of them are nodes: none is the head
    /// of a `for` that is an expression, the object of a `with`, or the `B` of `namespace A.B`.
    fn counted_stmts(&self) -> Option<[u32; MOST_KINDS + 2]> {
        let counts = self.counted(kind_counts::STMTS, StmtTag::COUNT)?;
        let heads = *(self.bound.kind_counts).get(kind_counts::HEADS_THAT_ARE_EXPRESSIONS)?;
        (heads == 0 && self.hir.with_bodies.is_empty() && counts[StmtTag::Module as usize + 1] < 2)
            .then_some(counts)
    }

    /// The same for the types: none is an error with an operand that is no node.
    fn counted_types(&self) -> Option<[u32; MOST_KINDS + 2]> {
        let counts = self.counted(kind_counts::TYPES, TypeTag::COUNT)?;
        (counts[TypeTag::JSDoc as usize + 1] == 0).then_some(counts)
    }

    /// The same for the patterns, of which those that are missing are no nodes: each is part of something.
    fn counted_pats(&self) -> Option<[u32; MOST_KINDS + 2]> {
        let mut counts = self.counted(kind_counts::PATS, PatTag::COUNT)?;
        counts[PatTag::Missing as usize + 1] = 0;
        let orphans = *(self.bound.kind_counts).get(kind_counts::PATS_WITHOUT_PARENT)?;
        (orphans == 0).then_some(counts)
    }

    #[inline]
    fn stmts(&self) -> &Grouped<{ StmtTag::COUNT }> {
        self.by_kind()
            .stmts
            .get_or_init(|| match self.counted_stmts() {
                Some(counts) => {
                    let kinds = self.hir.stmts.iter().map(|it| {
                        debug_assert_eq!(StmtTag::of(&it.kind) as u8, it.kind.tag() as u8);
                        StmtTag::of(&it.kind) as u8
                    });
                    Grouped::of_counted_kinds(0.., kinds, &counts)
                }
                None => Grouped::new(|kinds| self.stmt_tags_in_tree(kinds)),
            })
    }

    #[inline(never)]
    fn stmts_of(&self, tag: StmtTag) -> &[u32] {
        self.stmts().of(tag as usize)
    }

    #[inline]
    fn type_nodes(&self) -> &Grouped<{ TypeTag::COUNT }> {
        self.by_kind()
            .types
            .get_or_init(|| match self.counted_types() {
                Some(counts) => {
                    let kinds = self.hir.types.iter().map(|it| {
                        debug_assert_eq!(TypeTag::of(&it.kind) as u8, it.kind.tag() as u8);
                        TypeTag::of(&it.kind) as u8
                    });
                    Grouped::of_counted_kinds(0.., kinds, &counts)
                }
                None => Grouped::new(|kinds| self.type_tags_in_tree(kinds)),
            })
    }

    #[inline(never)]
    pub(crate) fn types_of(&self, tag: TypeTag) -> &[u32] {
        self.type_nodes().of(tag as usize)
    }

    #[inline]
    fn binaries(&self) -> &Grouped<{ BinOp::Comma as usize + 1 }> {
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
    fn unaries(&self) -> &Grouped<{ UnOp::PostDec as usize + 1 }> {
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
    fn pats(&self) -> &Grouped<{ PatTag::COUNT }> {
        self.by_kind()
            .pats
            .get_or_init(|| match self.counted_pats() {
                Some(counts) => {
                    let kinds = self.hir.pats.iter().map(|it| {
                        debug_assert_eq!(PatTag::of(&it.kind) as u8, it.kind.tag() as u8);
                        match PatTag::of(&it.kind) {
                            PatTag::Missing => NOT_IN_TREE,
                            tag => tag as u8,
                        }
                    });
                    Grouped::of_counted_kinds(0.., kinds, &counts)
                }
                None => Grouped::new(|kinds| self.pat_tags_in_tree(kinds)),
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
            Some(counts) => Grouped::<{ StmtTag::COUNT }>::present(&counts),
            None => self.stmts().present,
        })
    }

    #[inline(never)]
    fn present_types(&self) -> u64 {
        *(self.by_kind().present_types).get_or_init(|| match self.counted_types() {
            Some(counts) => Grouped::<{ TypeTag::COUNT }>::present(&counts),
            None => self.type_nodes().present,
        })
    }

    #[inline(never)]
    fn present_pats(&self) -> u64 {
        *(self.by_kind().present_pats).get_or_init(|| match self.counted_pats() {
            Some(counts) => Grouped::<{ PatTag::COUNT }>::present(&counts),
            None => self.pats().present,
        })
    }
}

/// Declares `File::$method`, which calls a function with every `$handle` of the file that is part of the tree. Which these are
/// is found out once for all rules, by `File::$list`.
macro_rules! every {
    ($($method:ident $list:ident $handle:ident $field:ident;)*) => {
        impl<'a> File<'a> {
            $(
                #[inline(never)]
                fn $list(&'a self) -> &'a [u32] {
                    self.by_kind().$field.get_or_init(|| {
                        // Nearly all are in the tree: room for all of them is made at once.
                        let all = 0..self.hir.$field.len() as u32;
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

every! {
    every_func funcs_in_tree Func fns;
    every_class classes_in_tree Class classes;
    every_member members_in_tree Member members;
    every_prop props_in_tree Prop props;
    every_param params_in_tree Param params;
    every_type_param type_params_in_tree TypeParam type_params;
    every_var_decl var_decls_in_tree VarDecl var_decls;
    every_case cases_in_tree Case cases;
    every_enum_member enum_members_in_tree EnumMember enum_members;
    every_import_spec import_specs_in_tree ImportSpec import_specs;
    every_export_spec export_specs_in_tree ExportSpec export_specs;
}

impl<'a> File<'a> {
    /// The expressions of a kind, in no particular order. For [`Rule::start`] to look closer than [`File::has_exprs`].
    pub fn exprs_of_kind(&'a self, tag: ExprTag) -> impl Iterator<Item = Expr<'a>> {
        self.exprs_of(tag).iter().map(|&id| grouped_expr(self, id))
    }

    /// `kind`: `Call` or `Dot`.
    fn by_name(&'a self, kind: ExprTag) -> &'a ByName {
        match kind {
            ExprTag::Call => {
                (self.by_kind().calls_by_name).get_or_init(|| Box::new(ByName::of_calls(self)))
            }
            _ => {
                (self.by_kind().members_by_name).get_or_init(|| Box::new(ByName::of_members(self)))
            }
        }
    }

    /// `by_name`, if it is needed or there already. `may_have_names`: the file may have a name of the groups that are asked
    /// for. If not, only the group `OTHERS` of them can have something.
    #[inline]
    fn by_name_if(&'a self, kind: ExprTag, may_have_names: bool) -> Option<&'a ByName> {
        let made = match kind {
            ExprTag::Call => self.by_kind().calls_by_name.get(),
            _ => self.by_kind().members_by_name.get(),
        };
        match (made, may_have_names) {
            (Some(made), _) => Some(made),
            (None, true) => Some(self.by_name(kind)),
            (None, false) => None,
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

    /// Whether one of these groups of the `Call`s or the `Dot`s has something.
    #[inline(never)]
    fn has_named(&'a self, kind: ExprTag, groups: [u64; 4], may_have_names: bool) -> bool {
        match self.by_name_if(kind, may_have_names) {
            Some(by_name) => by_name.has_any_of(groups),
            None => !self.others(kind).is_empty(),
        }
    }

    /// The `Call`s or the `Dot`s of these groups, in the order of `exprs_of`. The list is for `spare` afterwards.
    #[inline(never)]
    fn named(&'a self, kind: ExprTag, groups: [u64; 4], may_have_names: bool) -> Vec<u32> {
        let mut found = self.by_kind().spare.take();
        match self.by_name_if(kind, may_have_names) {
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
        self.exprs_on(ExprTag::Call, on, on.groups_of_calls())
    }

    /// The `Dot`s that a rule with this `on` is called with: see [`On::members_named`].
    pub fn members_on(&'a self, on: &On) -> impl Iterator<Item = Expr<'a>> + use<'a> {
        self.exprs_on(ExprTag::Dot, on, on.groups_of_members())
    }

    fn exprs_on(
        &'a self,
        kind: ExprTag,
        on: &On,
        groups: [u64; 4],
    ) -> impl Iterator<Item = Expr<'a>> + use<'a> {
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
    if !has_any_of(file, on) {
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
fn each_bit(mut bits: u64, mut visit: impl FnMut(usize)) {
    while bits != 0 {
        visit(bits.trailing_zeros() as usize);
        bits &= bits - 1;
    }
}

/// Whether `file` has something that a rule with `on` is called with. Where this is inlined `on` is a constant, or a part of one.
#[inline(always)]
fn has_any_of<'a>(file: &'a File<'a>, on: On) -> bool {
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
    let may_have_names = (calls[3] | members[3]) != 0 && file.may_have_names_of(&on);
    has_any = has_any || calls[3] != 0 && file.has_named(ExprTag::Call, calls, may_have_names);
    has_any = has_any || members[3] != 0 && file.has_named(ExprTag::Dot, members, may_have_names);
    has_any = has_any || on.has(On::OPTIONAL_CHAINS) && file.present_chained() != 0;
    macro_rules! sorts {
        ($($sort:ident $field:ident;)*) => {
            $(has_any = has_any || on.has(On::$sort) && !file.hir.$field.is_empty();)*
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
            $(if on.has(On::$sort) {
                file.$every(|it| rule.$method(it, cx));
            })*
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

/// Calls the listeners that depend on the order of the nodes.
struct Walk<'w, T> {
    running: &'w mut [T],
    enter: ByTag,
    exit: ByTag,
}

impl<T> Walk<'_, T> {
    /// `kind`, here and below: `NodeTags::index_of(node)`.
    #[inline]
    fn enter<'a>(&mut self, node: Node<'a>, kind: u8)
    where
        T: Running<'a>,
    {
        for &rule in self.enter.of(kind) {
            self.running[rule as usize].enter(node);
        }
    }

    #[inline]
    fn exit<'a>(&mut self, node: Node<'a>, kind: u8)
    where
        T: Running<'a>,
    {
        for &rule in self.exit.of(kind) {
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
    order
}

/// Enters and leaves the nodes that are listened for, without walking: the nodes of a file nest, so their spans determine the order.
/// Only the nodes of the kinds that are listened for are collected, from the vectors they are in, and sorted. The cost depends on
/// how many of those there are, not on the size of the file.
fn walk_listened<'a, T: Running<'a>>(file: &'a File<'a>, walk: &mut Walk<'_, T>) {
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
pub(crate) fn run<'a, S: Starts>(
    file: &'a File<'a>,
    rules: &[Enabled<'_, S>],
    wants_fixes: bool,
) -> Vec<Diagnostic> {
    file.sink.wants_fixes.set(wants_fixes);
    file.sink.thrown.take();
    run_rules(file, rules);
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

/// Those of `enabled` for which `file` has something: all others would not be started.
pub fn listening<'a, S: RuleSet>(file: &'a File<'a>, enabled: &RuleBits) -> RuleBits {
    let rows = S::LISTENS;
    let mut all = RuleBits::EMPTY;
    if *enabled == all {
        return all;
    }
    // All the words of a row, whichever have a rule that is enabled: how many there are is a constant, so there is no loop.
    let is_wanted = |row: &RuleBits| {
        let both = enabled.0.iter().zip(&row.0);
        both.fold(0, |any, (a, b)| any | (a & b)) != 0
    };
    let mut add = |row: &RuleBits| {
        for (to, from) in all.0.iter_mut().zip(&row.0) {
            *to |= from;
        }
    };
    add(&rows[On::ALWAYS]);
    // What groups the nodes of a sort is called only if a rule wants that sort.
    macro_rules! kinds {
        ($($sort:literal $present:ident;)*) => {
            $(if is_wanted(&S::LISTENS_TO_KINDS[$sort]) {
                each_bit(file.$present(), |kind| add(&rows[On::KINDS[$sort].0 + kind]));
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
    if is_wanted(&rows[On::SORTS]) && file.present_chained() != 0 {
        add(&rows[On::SORTS]);
    }
    // After `optional_chains`, in the order of the bits of `On`.
    macro_rules! sorts {
        ($($bit:literal $field:ident;)*) => {
            $(if !file.hir.$field.is_empty() {
                add(&rows[On::SORTS + $bit]);
            })*
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
    for (to, from) in all.0.iter_mut().zip(&enabled.0) {
        *to &= from;
    }
    all
}

fn run_rules<'r, 'a: 'r, S: Starts>(file: &'a File<'a>, rules: &'r [Enabled<'r, S>]) {
    let mut running: Vec<S::Run<'r, 'a>> = Vec::with_capacity(rules.len());
    for (i, enabled) in rules.iter().enumerate() {
        if enabled.severity == Severity::Off {
            continue;
        }
        running.extend(enabled.rule.start(Start {
            file,
            rule: i as u16,
            severity: enabled.severity,
        }));
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
        let mut listeners = Walk {
            running: &mut running,
            enter,
            exit,
        };
        walk_listened(file, &mut listeners);
    }

    for rule in &mut running {
        rule.finish();
    }
}

/// Declares the rules of a crate: one module in `rules/` for each, and the list of all of them. `b::Rule = a<true>` is a
/// rule without a module of its own: `a::Rule<true>`.
#[macro_export]
macro_rules! rules {
    ($($module:ident::$rule:ident $(= $of:ident<$argument:literal>)?,)*) => {
        pub mod rules {
            $($crate::rule_module! { $module::$rule $(= $of<$argument>)? })*
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
    ($module:ident::$rule:ident = $of:ident<$argument:literal>) => {
        pub mod $module {
            pub type $rule = super::$of::$rule<$argument>;
        }
    };
}
