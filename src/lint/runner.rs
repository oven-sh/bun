//! Runs rules on a file.

use crate::ast::{
    BinOp, Case, Chain, Class, EnumMember, ExportSpec, Expr, ExprTag, File, Func, Handle,
    ImportSpec, Member, NOT_IN_TREE, Node, Param, Pat, PatElem, PatProp, PatTag, Prop, Stmt,
    StmtTag, TupleElem, TypeNode, TypeParam, TypeTag, UnOp, VarDecl,
};
use crate::context::{Cx, CxBase, Diagnostic, Severity};
use crate::literal::Literal;
use crate::options::Options;
use crate::rule::{Meta, NodeTags, On, Rule};
use crate::rule_set::{RuleBits, RuleSet};
use crate::span::Span;
use bun_sema::hir;
use std::cell::OnceCell;

// ───────────────────────────── the nodes of a file, by kind ─────────────────────────────

/// Indices into one vector of the HIR, grouped by the kind of the node.
pub(crate) struct Grouped<const KINDS: usize> {
    ids: Vec<u32>,
    /// Where each kind starts in `ids`, and where the last ends.
    starts: [u32; MOST_KINDS + 2],
    /// A bit for each kind of which there is a node.
    present: u128,
}

const MOST_KINDS: usize = 2 * ExprTag::COUNT;
// `Grouped::present` has a bit for each.
const _: () = assert!(MOST_KINDS <= 128);

/// At `kind + 1`: how many of `kinds` are `kind`.
fn count_kinds(kinds: &[u8]) -> [u32; MOST_KINDS + 2] {
    let mut counts = [0u32; MOST_KINDS + 2];
    for &kind in kinds {
        if let Some(count) = counts.get_mut(kind as usize + 1) {
            *count += 1;
        }
    }
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
        Grouped::of_counted_kinds(all, kinds, &count_kinds(kinds))
    }

    /// `counts`: at `kind + 1`, how many of `kinds` are `kind`.
    fn of_counted_kinds(
        all: impl Iterator<Item = u32>,
        kinds: &[u8],
        counts: &[u32; MOST_KINDS + 2],
    ) -> Self {
        const { assert!(KINDS <= MOST_KINDS) };
        let (mut starts, mut present) = (*counts, 0u128);
        for kind in 0..KINDS {
            present |= u128::from(starts[kind + 1] != 0) << kind;
            starts[kind + 1] += starts[kind];
        }
        let mut next = starts;
        let mut ids = vec![0u32; starts[KINDS] as usize];
        for (id, &kind) in all.zip(kinds) {
            if let Some(at) = next.get_mut(kind as usize)
                && let Some(place) = ids.get_mut(*at as usize)
            {
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

impl Exprs {
    fn new(file: &File) -> Exprs {
        let mut exprs = Exprs::from_binder(file).unwrap_or_else(|| Exprs::from_hir(file));
        for kind in 0..ExprTag::COUNT {
            let parts = (exprs.grouped.present >> (2 * kind)) & 3;
            exprs.present |= u64::from(parts != 0) << kind;
            exprs.chained |= u64::from(parts & 2 != 0) << kind;
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
            Grouped::of_counted_kinds(0..kinds.len() as u32, kinds, &counts);
        if bun_core::strings::contains_char(file.text(), b'`') {
            let (strings, templates) =
                (2 * ExprTag::String as usize, 2 * ExprTag::Template as usize);
            const { assert!((ExprTag::String as usize) < ExprTag::Template as usize) };
            let is_template = |id: &u32| file.expr_in_tree(*id as usize) == Some(ExprTag::Template);
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
                for kind in [strings, templates] {
                    let has_any = grouped.starts[kind + 1] > grouped.starts[kind];
                    grouped.present &= !(1 << kind);
                    grouped.present |= u128::from(has_any) << kind;
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
            grouped: Grouped::of_counted_kinds(0..kinds.len() as u32, &kinds, &counts),
            present: 0,
            chained: 0,
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
    /// The `ExprTag::Binary` and the `ExprTag::Unary` by operator.
    binaries: OnceCell<Grouped<{ BinOp::Comma as usize + 1 }>>,
    unaries: OnceCell<Grouped<{ UnOp::PostDec as usize + 1 }>>,
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

    #[inline]
    fn stmts(&self) -> &Grouped<{ StmtTag::COUNT }> {
        (self.by_kind().stmts).get_or_init(|| Grouped::new(|kinds| self.stmt_tags_in_tree(kinds)))
    }

    #[inline(never)]
    fn stmts_of(&self, tag: StmtTag) -> &[u32] {
        self.stmts().of(tag as usize)
    }

    #[inline]
    fn type_nodes(&self) -> &Grouped<{ TypeTag::COUNT }> {
        (self.by_kind().types).get_or_init(|| Grouped::new(|kinds| self.type_tags_in_tree(kinds)))
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
        (self.by_kind().pats).get_or_init(|| Grouped::new(|kinds| self.pat_tags_in_tree(kinds)))
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
        self.binaries().present as u64
    }

    #[inline(never)]
    fn present_unaries(&self) -> u64 {
        self.unaries().present as u64
    }

    #[inline(never)]
    fn present_stmts(&self) -> u64 {
        self.stmts().present as u64
    }

    #[inline(never)]
    fn present_types(&self) -> u64 {
        self.type_nodes().present as u64
    }

    #[inline(never)]
    fn present_pats(&self) -> u64 {
        self.pats().present as u64
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
        self.exprs_of(tag)
            .iter()
            .map(|&id| Expr::from_raw(self, id))
    }

    /// The same for statements.
    pub fn stmts_of_kind(&'a self, tag: StmtTag) -> impl Iterator<Item = Stmt<'a>> {
        self.stmts_of(tag)
            .iter()
            .map(|&id| Stmt::from_raw(self, id))
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
                .for_each(|&id| visit(Expr::from_raw(self, id)));
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

    /// Calls `visit` with every node of the kinds in `tags`, sort by sort.
    pub(crate) fn every_node_of(&'a self, tags: NodeTags, visit: &mut dyn FnMut(Node<'a>)) {
        for tag in EXPR_TAGS {
            if tags.intersects(tag.into()) {
                self.exprs_of(tag)
                    .iter()
                    .for_each(|&id| visit(Node::Expr(Expr::from_raw(self, id))));
            }
        }
        for tag in StmtTag::ALL {
            if tags.intersects(tag.into()) {
                self.stmts_of(tag)
                    .iter()
                    .for_each(|&id| visit(Node::Stmt(Stmt::from_raw(self, id))));
            }
        }
        for tag in TypeTag::ALL {
            if tags.intersects(tag.into()) {
                self.types_of(tag)
                    .iter()
                    .for_each(|&id| visit(Node::Type(TypeNode::from_raw(self, id))));
            }
        }
        if tags.intersects(NodeTags::PAT) {
            for tag in PatTag::ALL {
                self.pats_of(tag)
                    .iter()
                    .for_each(|&id| visit(Node::Pat(Pat::from_raw(self, id))));
            }
        }
        macro_rules! sorts {
            ($($tags:ident $every:ident $variant:ident;)*) => {
                $(if tags.intersects(NodeTags::$tags) {
                    self.$every(|it| visit(Node::$variant(it)));
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
            visit(Node::File(self));
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
    /// Of the rule.
    meta: &'static Meta,
    rule: u16,
    severity: Severity,
}

impl<'a> Start<'a> {
    #[inline]
    fn base(self) -> CxBase<'a> {
        CxBase {
            file: self.file,
            meta: self.meta,
            rule: self.rule,
            severity: self.severity,
            reports: std::cell::Cell::new(0),
            is_capped: std::cell::Cell::new(false),
        }
    }
}

/// What can be started on a file: a rule, or one of several.
pub trait Starts: Send + Sync {
    /// It at work on a file, after what takes the nodes in no particular order.
    type Run<'r, 'a: 'r>: Running<'a>
    where
        Self: 'r;

    fn meta(&self) -> &'static Meta;

    /// Calls what takes the nodes in no particular order. `None`: nothing is left to call.
    #[doc(hidden)]
    fn start<'r, 'a: 'r>(&'r self, start: Start<'a>) -> Option<Self::Run<'r, 'a>>;
}

impl<R: Rule> Starts for R {
    type Run<'r, 'a: 'r> = Box<Later<'r, 'a, R>>;

    #[inline]
    fn meta(&self) -> &'static Meta {
        &R::META
    }

    #[inline]
    fn start<'r, 'a: 'r>(&'r self, start: Start<'a>) -> Option<Box<Later<'r, 'a, R>>> {
        started(self, start)
    }
}

impl<'a, T: Running<'a>> Running<'a> for Box<T> {
    #[inline]
    fn walks(&self) -> (NodeTags, NodeTags) {
        (**self).walks()
    }

    #[inline]
    fn enter(&mut self, node: Node<'a>) {
        (**self).enter(node);
    }

    #[inline]
    fn exit(&mut self, node: Node<'a>) {
        (**self).exit(node);
    }

    #[inline]
    fn finish(&mut self) {
        (**self).finish();
    }
}

/// `None`: nothing is left to call.
#[inline(always)]
fn started<'r, 'a: 'r, R: Rule>(rule: &'r R, start: Start<'a>) -> Option<Box<Later<'r, 'a, R>>> {
    let file = start.file;
    let on = R::ON.and(&rule.narrow(file));
    if !has_any_of(file, on) {
        return None;
    }
    let mut cx = Cx {
        state: Rule::start(rule, file)?,
        base: start.base(),
    };
    call_unordered(rule, file, &on, &mut cx);
    on.has_later().then(|| Box::new(Later { rule, on, cx }))
}

/// For [`rules!`](crate::rules): an arm of a `match` on the rules of a crate is a call of this.
#[doc(hidden)]
#[inline(never)]
pub fn start<'r, 'a: 'r, R: Rule>(rule: &'r R, start: Start<'a>) -> Option<Box<Later<'r, 'a, R>>> {
    started(rule, start)
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
    each_bit(on.exprs, |kind| {
        for &id in file.exprs_of(EXPR_TAGS[kind]) {
            rule.expr(Expr::from_raw(file, id), cx);
        }
    });
    if on.has(On::OPTIONAL_CHAINS) {
        for kind in CHAINED {
            for &id in file.chained_exprs_of(kind) {
                rule.optional_chain(Expr::from_raw(file, id), cx);
            }
        }
    }
    each_bit(on.binaries, |op| {
        for &id in file.binaries_at(op) {
            rule.binary(Expr::from_raw(file, id), cx);
        }
    });
    each_bit(on.unaries, |op| {
        for &id in file.unaries_at(op) {
            rule.unary(Expr::from_raw(file, id), cx);
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
        for it in number_literals(file) {
            rule.number_literal(it, cx);
        }
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
    /// A part of `R::ON`.
    on: On,
    cx: Cx<'a, R>,
}

impl<'a, R: Rule> Running<'a> for Later<'_, 'a, R> {
    #[inline]
    fn walks(&self) -> (NodeTags, NodeTags) {
        (self.on.enter, self.on.exit)
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
        if self.on.has(On::FINISH) {
            self.rule.finish(&mut self.cx);
        }
    }
}

/// How a rule is found by its name.
#[derive(Copy, Clone)]
pub struct RuleEntry {
    pub meta: &'static Meta,
    /// [`Rule::validate`]
    pub validate: fn(&Options) -> Result<(), Vec<u8>>,
}

impl RuleEntry {
    pub const fn of<R: Rule>() -> RuleEntry {
        RuleEntry {
            meta: &R::META,
            validate: R::validate,
        }
    }
}

#[inline(never)]
fn number_literals<'a>(file: &'a File<'a>) -> Vec<Literal<'a>> {
    let mut all = Vec::new();
    file.every_number_literal(&mut |it| all.push(it));
    all
}

#[inline(never)]
fn nodes_of<'a>(file: &'a File<'a>, tags: NodeTags) -> Vec<Node<'a>> {
    let mut all = Vec::new();
    file.every_node_of(tags, &mut |node| all.push(node));
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

    #[inline]
    fn of(&self, node: Node) -> &[u16] {
        let index = NodeTags::index_of(node) as usize;
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
    #[inline]
    fn enter<'a>(&mut self, node: Node<'a>)
    where
        T: Running<'a>,
    {
        for &rule in self.enter.of(node) {
            self.running[rule as usize].enter(node);
        }
    }

    #[inline]
    fn exit<'a>(&mut self, node: Node<'a>)
    where
        T: Running<'a>,
    {
        for &rule in self.exit.of(node) {
            self.running[rule as usize].exit(node);
        }
    }
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
    file.every_node_of(walk.enter.tags | walk.exit.tags, &mut |node| {
        let span = node.span();
        found.push(Found {
            start: span.start,
            end: span.end,
            rank: rank(node),
            node,
        });
    });
    let keys = found.iter().enumerate();
    let keys = keys.map(|(at, it)| Span::new(it.start, it.end).sort_key(u16::from(it.rank), at));
    let mut order: Vec<u128> = keys.collect();
    order.sort();

    // The nodes that have been entered and not left, each with its end.
    let mut open: Vec<(u32, Node<'a>)> = Vec::new();
    for it in order
        .iter()
        .filter_map(|&key| found.get(key as u32 as usize))
    {
        while let Some(&(end, node)) = open.last()
            && end <= it.start
            && !matches!(node, Node::File(_))
        {
            open.pop();
            walk.exit(node);
        }
        walk.enter(it.node);
        open.push((it.end, it.node));
    }
    while let Some((_, node)) = open.pop() {
        walk.exit(node);
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

/// Runs `rules` on `file`. What they report is sorted by position. `Diagnostic::rule` is an index
/// into `rules`.
///
/// `wants_fixes`: whether the fixes and suggestions are going to be read.
pub fn run<'a, S: Starts>(
    file: &'a File<'a>,
    rules: &[Enabled<'_, S>],
    wants_fixes: bool,
) -> Vec<Diagnostic> {
    file.sink.wants_fixes.set(wants_fixes);
    file.sink.bytes.borrow_mut().clear();
    run_rules(file, rules);
    sorted(file.sink.diagnostics.take())
}

fn sorted(diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    // ESLint sorts by line and column alone, which leaves what starts at the same place in the order it was reported: for a
    // listener that is called on entering a node, the outer node first.
    let key = |it: &Diagnostic| (it.span.start, std::cmp::Reverse(it.span.end), it.rule);
    if diagnostics.is_sorted_by_key(key) {
        return diagnostics;
    }
    // The keys are sorted, not what is reported, which is many times as large.
    let mut order: Vec<u128> = diagnostics
        .iter()
        .enumerate()
        .map(|(at, it)| it.span.sort_key(it.rule, at))
        .collect();
    order.sort();
    let mut diagnostics: Vec<Option<Diagnostic>> = diagnostics.into_iter().map(Some).collect();
    order
        .iter()
        .filter_map(|&key| diagnostics.get_mut(key as u32 as usize)?.take())
        .collect()
}

/// Those of `enabled` for which `file` has something: all others would not be started.
pub fn listening<'a, S: RuleSet>(file: &'a File<'a>, enabled: &RuleBits) -> RuleBits {
    let rows = S::LISTENS;
    let mut all = rows[On::ALWAYS];
    // What groups the nodes of a sort is called only if a rule wants that sort.
    macro_rules! kinds {
        ($($sort:literal $present:ident;)*) => {
            $(if !enabled.and(&S::LISTENS_TO_KINDS[$sort]).is_empty() {
                each_bit(file.$present(), |kind| all = all.or(&rows[On::KINDS[$sort].0 + kind]));
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
    if !enabled.and(&rows[On::SORTS]).is_empty() && file.present_chained() != 0 {
        all = all.or(&rows[On::SORTS]);
    }
    // After `optional_chains`, in the order of the bits of `On`.
    macro_rules! sorts {
        ($($bit:literal $field:ident;)*) => {
            $(if !file.hir.$field.is_empty() {
                all = all.or(&rows[On::SORTS + $bit]);
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
    enabled.and(&all)
}

fn run_rules<'r, 'a: 'r, S: Starts>(file: &'a File<'a>, rules: &'r [Enabled<'r, S>]) {
    let has_types = file.types.is_some();
    let mut running: Vec<S::Run<'r, 'a>> = Vec::with_capacity(rules.len());
    for (i, enabled) in rules.iter().enumerate() {
        let meta = enabled.rule.meta();
        if enabled.severity == Severity::Off || meta.requires_types && !has_types {
            continue;
        }
        running.extend(enabled.rule.start(Start {
            file,
            meta,
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

/// Declares the rules of a crate: one module in `rules/` for each, and the list of all of them.
#[macro_export]
macro_rules! rules {
    ($($module:ident::$rule:ident,)*) => {
        pub mod rules {
            $(pub mod $module;)*
        }

        /// Sorted by name.
        pub static RULES: &[$crate::runner::RuleEntry] = &[
            $($crate::runner::RuleEntry::of::<rules::$module::$rule>(),)*
        ];

        $crate::rules_as_a_set! { $($module::$rule,)* }
    };
}
