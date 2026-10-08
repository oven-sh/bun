//! Runs rules on a file.

use crate::ast::{
    BinOp, Case, Chain, NOT_IN_TREE, Class, EnumMember, ExportSpec, Expr, ExprTag, File, Func, Handle, ImportSpec, Member,
    Node, Param, Pat, PatElem, PatProp, PatTag, Prop, Stmt, StmtTag, TupleElem, TypeNode, TypeParam, TypeTag, UnOp, VarDecl,
};
use crate::code_path::{Event, Step, steps};
use crate::context::{Cx, Diagnostic, Severity};
use crate::options::Options;
use crate::rule::{Entries, Entry, Listeners, Meta, NodeTags, Rule};
use bun_sema::atom::Atom;
use bun_sema::hir;
use std::cell::OnceCell;

// ───────────────────────────── the nodes of a file, by kind ─────────────────────────────

/// Indices into one vector of the HIR, grouped by the kind of the node.
pub(crate) struct Grouped<const KINDS: usize> {
    /// After the nodes of all kinds come those that are left out.
    ids: Vec<u32>,
    /// Where each kind starts in `ids`, and where the last ends.
    starts: [u32; MOST_KINDS + 2],
}

const MOST_KINDS: usize = 2 * ExprTag::COUNT;

impl<const KINDS: usize> Grouped<KINDS> {
    /// `tags`: writes the kind of each node of a vector of the HIR, `NOT_IN_TREE` to leave it out.
    fn new(tags: impl FnOnce(&mut Vec<u8>)) -> Self {
        let mut kinds = Vec::new();
        tags(&mut kinds);
        kinds.iter_mut().for_each(|kind| *kind = (*kind).min(KINDS as u8));
        Grouped::of_kinds(0..kinds.len() as u32, &kinds)
    }

    /// `kind_of(id)`: the kind of the node `id`, which is one of `all`, or `None` to leave it out.
    fn of_ids(all: impl ExactSizeIterator<Item = u32> + Clone, kind_of: impl Fn(u32) -> Option<usize>) -> Self {
        let kinds: Vec<u8> = all.clone().map(|id| kind_of(id).map_or(KINDS, |kind| kind.min(KINDS)) as u8).collect();
        Grouped::of_kinds(all, &kinds)
    }

    /// `kinds`: the kind of each of `all`, `KINDS` to leave it out.
    fn of_kinds(all: impl Iterator<Item = u32>, kinds: &[u8]) -> Self {
        const { assert!(KINDS <= MOST_KINDS) };
        let mut starts = [0u32; MOST_KINDS + 2];
        for &kind in kinds {
            starts[kind as usize + 1] += 1;
        }
        for kind in 0..=KINDS {
            starts[kind + 1] += starts[kind];
        }
        let mut next = starts;
        let mut ids = vec![0u32; kinds.len()];
        for (id, &kind) in all.zip(kinds) {
            let at = &mut next[kind as usize];
            if let Some(place) = ids.get_mut(*at as usize) {
                *place = id;
            }
            *at += 1;
        }
        Grouped { ids, starts }
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
    names: Names,
}

/// A set of names that may have more in it than was put in.
struct Names(Box<[u64; Names::BITS / 64]>);

impl Names {
    const BITS: usize = 1 << 14;

    #[inline]
    fn add(&mut self, name: Atom) {
        self.0[name.0 as usize % Names::BITS / 64] |= 1 << (name.0 % 64);
    }

    #[inline]
    fn may_have(&self, name: Atom) -> bool {
        self.0[name.0 as usize % Names::BITS / 64] & (1 << (name.0 % 64)) != 0
    }
}

impl Exprs {
    fn new(file: &File) -> Exprs {
        const LEFT_OUT: u8 = 2 * ExprTag::COUNT as u8;
        let mut names = Names(Box::new([0; Names::BITS / 64]));
        let mut kinds = Vec::new();
        file.expr_tags_in_tree(&mut kinds);
        for (kind, raw) in kinds.iter_mut().zip(file.hir.exprs) {
            if *kind == NOT_IN_TREE {
                *kind = LEFT_OUT;
                continue;
            }
            let chain = match raw.kind {
                hir::ExprKind::Ident(name) | hir::ExprKind::PrivateIdentifier(name) | hir::ExprKind::String(name) => {
                    names.add(name);
                    Chain::No
                }
                hir::ExprKind::Dot { name, chain, .. } => {
                    names.add(name);
                    chain
                }
                hir::ExprKind::Index { chain, .. } => chain,
                hir::ExprKind::Call(call) => file.hir.calls.get(call.idx()).map_or(Chain::No, |call| call.chain),
                _ => Chain::No,
            };
            *kind = 2 * *kind + u8::from(chain != Chain::No);
        }
        Exprs {
            grouped: Grouped::of_kinds(0..kinds.len() as u32, &kinds),
            names,
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
    entity_names: OnceCell<Names>,
    pub(crate) nearby_line: crate::source::NearbyLine,
    pub(crate) string_literals: OnceCell<Vec<crate::literal::RawLiteral>>,
    /// See [`File::mentions`].
    pub(crate) has_other_spellings: OnceCell<bool>,
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

    fn exprs_of(&self, tag: ExprTag) -> &[u32] {
        let grouped = &self.exprs().grouped;
        &grouped.ids[grouped.starts[2 * tag as usize] as usize..grouped.starts[2 * tag as usize + 2] as usize]
    }

    /// Those of `exprs_of` that are part of an optional chain.
    pub(crate) fn chained_exprs_of(&self, tag: ExprTag) -> &[u32] {
        self.exprs().grouped.of(2 * tag as usize + 1)
    }

    /// Whether an expression of the file may be the identifier `text`, the member access `a.text`, or the string or the template
    /// without substitutions `"text"`, however it is spelled. `false` is certain, `true` is not. Not for private names.
    ///
    /// For [`Rule::register`]: a rule that is about `eval` or `a.hasOwnProperty` has nothing to listen for in a file in which
    /// no expression has that name. That costs next to nothing, unlike a listener that is called with every call or every member
    /// access of the file. It says nothing about names that are not expressions: keys, bindings, names in types, imports.
    pub fn has_expr_named(&self, text: &str) -> bool {
        self.exprs().names.may_have(self.atoms.intern(text.as_bytes()))
    }

    /// Whether [`File::has_expr_named`] holds for one of `texts`.
    pub fn has_expr_named_any(&self, texts: &[&str]) -> bool {
        texts.iter().any(|text| self.has_expr_named(text))
    }

    /// The same for the names of which an [`EntityName`](crate::ast::EntityName) consists: whether `text` may be the `A`, the `B`
    /// or the `C` of an `A.B.C` in a type, in a heritage clause or in `import x = A.B.C`.
    pub fn has_entity_named(&self, text: &str) -> bool {
        let names = self.by_kind().entity_names.get_or_init(|| {
            let mut names = Names(Box::new([0; Names::BITS / 64]));
            self.hir.names.iter().for_each(|name| names.add(name.text));
            names
        });
        names.may_have(self.atoms.intern(text.as_bytes()))
    }

    /// Whether [`File::has_entity_named`] holds for one of `texts`.
    pub fn has_entity_named_any(&self, texts: &[&str]) -> bool {
        texts.iter().any(|text| self.has_entity_named(text))
    }

    fn stmts_of(&self, tag: StmtTag) -> &[u32] {
        let grouped = (self.by_kind().stmts)
            .get_or_init(|| Grouped::new(|kinds| self.stmt_tags_in_tree(kinds)));
        grouped.of(tag as usize)
    }

    pub(crate) fn types_of(&self, tag: TypeTag) -> &[u32] {
        let grouped = (self.by_kind().types)
            .get_or_init(|| Grouped::new(|kinds| self.type_tags_in_tree(kinds)));
        grouped.of(tag as usize)
    }

    pub(crate) fn binaries_of(&self, op: BinOp) -> &[u32] {
        let grouped = self.by_kind().binaries.get_or_init(|| {
            Grouped::of_ids(self.exprs_of(ExprTag::Binary).iter().copied(), |id| match self.hir.exprs.get(id as usize)?.kind {
                hir::ExprKind::Binary { op, .. } => Some(op as usize),
                _ => None,
            })
        });
        grouped.of(op as usize)
    }

    pub(crate) fn unaries_of(&self, op: UnOp) -> &[u32] {
        let grouped = self.by_kind().unaries.get_or_init(|| {
            Grouped::of_ids(self.exprs_of(ExprTag::Unary).iter().copied(), |id| match self.hir.exprs.get(id as usize)?.kind {
                hir::ExprKind::Unary { op, .. } => Some(op as usize),
                _ => None,
            })
        });
        grouped.of(op as usize)
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

    pub(crate) fn pats_of(&self, tag: PatTag) -> &[u32] {
        let grouped = (self.by_kind().pats)
            .get_or_init(|| Grouped::new(|kinds| self.pat_tags_in_tree(kinds)));
        grouped.of(tag as usize)
    }
}

/// Declares `File::$method`, which calls a function with every `$handle` of the file that is part of the tree. Which these are
/// is found out once for all rules, by `File::$list`.
macro_rules! every {
    ($($method:ident $list:ident $handle:ident $field:ident;)*) => {
        impl<'a> File<'a> {
            $(
                fn $list(&'a self) -> &'a [u32] {
                    self.by_kind().$field.get_or_init(|| {
                        let all = 0..self.hir.$field.len() as u32;
                        all.filter(|&id| <$handle as Handle>::from_raw(self, id).is_in_tree()).collect()
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
    /// The expressions of a kind, in no particular order. For [`Rule::register`] to look closer than [`File::has_exprs`] does.
    pub fn exprs_of_kind(&'a self, tag: ExprTag) -> impl Iterator<Item = Expr<'a>> {
        self.exprs_of(tag).iter().map(|&id| Expr::from_raw(self, id))
    }

    /// The same for statements.
    pub fn stmts_of_kind(&'a self, tag: StmtTag) -> impl Iterator<Item = Stmt<'a>> {
        self.stmts_of(tag).iter().map(|&id| Stmt::from_raw(self, id))
    }

    /// The same for functions: what [`Listeners::funcs`] is called with.
    pub fn funcs(&'a self) -> impl Iterator<Item = Func<'a>> {
        (0..self.hir.fns.len()).map(|i| Func::from_raw(self, i as u32)).filter(|it| it.is_in_tree())
    }

    /// The same for classes: what [`Listeners::classes`] is called with.
    pub fn classes(&'a self) -> impl Iterator<Item = Class<'a>> {
        (0..self.hir.classes.len()).map(|i| Class::from_raw(self, i as u32)).filter(|it| it.is_in_tree())
    }

    pub(crate) fn every_expr_of(&'a self, tags: &[ExprTag], mut visit: impl FnMut(Expr<'a>)) {
        for &tag in tags {
            self.exprs_of(tag).iter().for_each(|&id| visit(Expr::from_raw(self, id)));
        }
    }

    pub(crate) fn every_stmt_of(&'a self, tags: &[StmtTag], mut visit: impl FnMut(Stmt<'a>)) {
        for &tag in tags {
            self.stmts_of(tag).iter().for_each(|&id| visit(Stmt::from_raw(self, id)));
        }
    }

    pub(crate) fn every_type_of(&'a self, tags: &[TypeTag], mut visit: impl FnMut(TypeNode<'a>)) {
        for &tag in tags {
            self.types_of(tag).iter().for_each(|&id| visit(TypeNode::from_raw(self, id)));
        }
    }

    /// Calls `visit` with every node of the kinds in `tags`, sort by sort.
    pub(crate) fn every_node_of(&'a self, tags: NodeTags, mut visit: impl FnMut(Node<'a>)) {
        for tag in EXPR_TAGS {
            if tags.intersects(tag.into()) {
                self.exprs_of(tag).iter().for_each(|&id| visit(Node::Expr(Expr::from_raw(self, id))));
            }
        }
        for tag in StmtTag::ALL {
            if tags.intersects(tag.into()) {
                self.stmts_of(tag).iter().for_each(|&id| visit(Node::Stmt(Stmt::from_raw(self, id))));
            }
        }
        for tag in TypeTag::ALL {
            if tags.intersects(tag.into()) {
                self.types_of(tag).iter().for_each(|&id| visit(Node::Type(TypeNode::from_raw(self, id))));
            }
        }
        if tags.intersects(NodeTags::PAT) {
            for tag in PatTag::ALL {
                self.pats_of(tag).iter().for_each(|&id| visit(Node::Pat(Pat::from_raw(self, id))));
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
            if it.pat().is_none_or(|pat| self.pat_in_tree(pat.id().idx()).is_some()) {
                visit(it);
            }
        }
    }
}

// ───────────────────────────── a rule, whatever its type ─────────────────────────────

/// A [`Rule`] with its options, whatever its type.
pub trait AnyRule: Send + Sync {
    fn meta(&self) -> &'static Meta;

    /// `None`: it listens for nothing that the file has.
    #[doc(hidden)]
    fn start<'r, 'a: 'r>(&'r self, start: Start<'a>) -> Option<Box<dyn Running<'a> + 'r>>;
}

/// What a rule is given to start on a file.
#[doc(hidden)]
#[derive(Copy, Clone)]
pub struct Start<'a> {
    file: &'a File<'a>,
    rule: u16,
    severity: Severity,
}

impl<R: Rule> AnyRule for R {
    fn meta(&self) -> &'static Meta {
        &R::META
    }

    fn start<'r, 'a: 'r>(&'r self, start: Start<'a>) -> Option<Box<dyn Running<'a> + 'r>> {
        let mut on = Listeners::new(start.file);
        let state = self.register(&mut on, start.file);
        if on.entries.is_empty() {
            return None;
        }
        Some(Box::new(Run {
            rule: self,
            entries: on.entries,
            cx: Cx {
                state,
                file: start.file,
                rule: start.rule,
                severity: start.severity,
            },
        }))
    }
}

/// How a rule is found by its name and made from its options.
#[derive(Copy, Clone)]
pub struct RuleEntry {
    pub meta: &'static Meta,
    pub build: fn(&Options) -> Box<dyn AnyRule>,
    /// [`Rule::validate`]
    pub validate: fn(&Options) -> Result<(), Vec<u8>>,
}

impl RuleEntry {
    pub const fn of<R: Rule>() -> RuleEntry {
        RuleEntry {
            meta: &R::META,
            build: |options| Box::new(R::new(options)),
            validate: R::validate,
        }
    }
}

/// A rule at work on a file.
#[doc(hidden)]
pub trait Running<'a> {
    /// Calls the listeners that take the nodes in no particular order.
    fn run_unordered(&mut self);
    /// Tells which of its listeners the walk has to call.
    fn listeners_of_walk(&self, add: &mut dyn FnMut(WalkListener));
    /// Calls the listener at `entry` with `node`.
    fn call(&mut self, entry: u16, node: Node<'a>);
    fn code_path_event(&mut self, entry: u16, event: Event<'a>);
    fn finish(&mut self);
}

#[doc(hidden)]
pub enum WalkListener {
    Enter(NodeTags, u16),
    Exit(NodeTags, u16),
    /// The index is `event_index` of the events it is for.
    CodePath(usize, u16),
}

const EVENTS: usize = 7;

fn event_index(event: &Event) -> usize {
    match event {
        Event::CodePathStart(..) => 0,
        Event::CodePathEnd(..) => 1,
        Event::SegmentStart(..) => 2,
        Event::SegmentEnd(..) => 3,
        Event::UnreachableSegmentStart(..) => 4,
        Event::UnreachableSegmentEnd(..) => 5,
        Event::SegmentLoop(..) => 6,
    }
}

struct Run<'r, 'a, R: Rule> {
    rule: &'r R,
    entries: Entries<'a, R>,
    cx: Cx<'a, R>,
}

impl<'a, R: Rule> Running<'a> for Run<'_, 'a, R> {
    fn run_unordered(&mut self) {
        let (rule, cx) = (self.rule, &mut self.cx);
        let file = cx.file;
        for entry in &self.entries {
            match *entry {
                Entry::Exprs(tag, listener) => {
                    for &id in file.exprs_of(tag) {
                        listener(rule, Expr::from_raw(file, id), cx);
                    }
                }
                Entry::Stmts(tag, listener) => {
                    for &id in file.stmts_of(tag) {
                        listener(rule, Stmt::from_raw(file, id), cx);
                    }
                }
                Entry::Types(tag, listener) => {
                    for &id in file.types_of(tag) {
                        listener(rule, TypeNode::from_raw(file, id), cx);
                    }
                }
                Entry::Pats(tag, listener) => {
                    for &id in file.pats_of(tag) {
                        listener(rule, Pat::from_raw(file, id), cx);
                    }
                }
                Entry::Chained(tag, listener) => {
                    for &id in file.chained_exprs_of(tag) {
                        listener(rule, Expr::from_raw(file, id), cx);
                    }
                }
                Entry::Binaries(op, listener) => {
                    for &id in file.binaries_of(op) {
                        listener(rule, Expr::from_raw(file, id), cx);
                    }
                }
                Entry::Unaries(op, listener) => {
                    for &id in file.unaries_of(op) {
                        listener(rule, Expr::from_raw(file, id), cx);
                    }
                }
                Entry::Funcs(listener) => file.every_func(|it| listener(rule, it, cx)),
                Entry::Classes(listener) => file.every_class(|it| listener(rule, it, cx)),
                Entry::Members(listener) => file.every_member(|it| listener(rule, it, cx)),
                Entry::Props(listener) => file.every_prop(|it| listener(rule, it, cx)),
                Entry::Params(listener) => file.every_param(|it| listener(rule, it, cx)),
                Entry::TypeParams(listener) => file.every_type_param(|it| listener(rule, it, cx)),
                Entry::VarDecls(listener) => file.every_var_decl(|it| listener(rule, it, cx)),
                Entry::Cases(listener) => file.every_case(|it| listener(rule, it, cx)),
                Entry::EnumMembers(listener) => file.every_enum_member(|it| listener(rule, it, cx)),
                Entry::ImportSpecs(listener) => file.every_import_spec(|it| listener(rule, it, cx)),
                Entry::ExportSpecs(listener) => file.every_export_spec(|it| listener(rule, it, cx)),
                Entry::StringLiterals(listener) => file.every_string_literal(|it| listener(rule, it, cx)),
                Entry::NumberLiterals(listener) => file.every_number_literal(|it| listener(rule, it, cx)),
                Entry::Symbols(listener) => {
                    for symbol in file.symbols() {
                        listener(rule, symbol, cx);
                    }
                }
                Entry::Nodes(tags, listener) => file.every_node_of(tags, |node| listener(rule, node, cx)),
                Entry::Enter(..)
                | Entry::Exit(..)
                | Entry::CodePathStart(_)
                | Entry::CodePathEnd(_)
                | Entry::SegmentStart(_)
                | Entry::SegmentEnd(_)
                | Entry::UnreachableSegmentStart(_)
                | Entry::UnreachableSegmentEnd(_)
                | Entry::SegmentLoop(_)
                | Entry::Finish(_) => {}
            }
        }
    }

    fn listeners_of_walk(&self, add: &mut dyn FnMut(WalkListener)) {
        for (i, entry) in self.entries.iter().enumerate() {
            match entry {
                Entry::Enter(tags, _) => add(WalkListener::Enter(*tags, i as u16)),
                Entry::Exit(tags, _) => add(WalkListener::Exit(*tags, i as u16)),
                Entry::CodePathStart(_) => add(WalkListener::CodePath(0, i as u16)),
                Entry::CodePathEnd(_) => add(WalkListener::CodePath(1, i as u16)),
                Entry::SegmentStart(_) => add(WalkListener::CodePath(2, i as u16)),
                Entry::SegmentEnd(_) => add(WalkListener::CodePath(3, i as u16)),
                Entry::UnreachableSegmentStart(_) => add(WalkListener::CodePath(4, i as u16)),
                Entry::UnreachableSegmentEnd(_) => add(WalkListener::CodePath(5, i as u16)),
                Entry::SegmentLoop(_) => add(WalkListener::CodePath(6, i as u16)),
                _ => {}
            }
        }
    }

    #[inline]
    fn call(&mut self, entry: u16, node: Node<'a>) {
        if let Some(&(Entry::Enter(_, listener) | Entry::Exit(_, listener))) =
            self.entries.get(entry as usize)
        {
            listener(self.rule, node, &mut self.cx);
        }
    }

    fn code_path_event(&mut self, entry: u16, event: Event<'a>) {
        let (rule, cx) = (self.rule, &mut self.cx);
        match (self.entries.get(entry as usize), event) {
            (Some(Entry::CodePathStart(on)), Event::CodePathStart(path, node))
            | (Some(Entry::CodePathEnd(on)), Event::CodePathEnd(path, node)) => {
                on(rule, path, node, cx)
            }
            (Some(Entry::SegmentStart(on)), Event::SegmentStart(segment, node))
            | (Some(Entry::SegmentEnd(on)), Event::SegmentEnd(segment, node))
            | (
                Some(Entry::UnreachableSegmentStart(on)),
                Event::UnreachableSegmentStart(segment, node),
            )
            | (Some(Entry::UnreachableSegmentEnd(on)), Event::UnreachableSegmentEnd(segment, node)) => {
                on(rule, segment, node, cx)
            }
            (Some(Entry::SegmentLoop(on)), Event::SegmentLoop(from, to, node)) => {
                on(rule, from, to, node, cx)
            }
            _ => {}
        }
    }

    fn finish(&mut self) {
        for entry in &self.entries {
            if let Entry::Finish(listener) = *entry {
                listener(self.rule, &mut self.cx);
            }
        }
    }
}

// ───────────────────────────── the walk ─────────────────────────────

/// The listeners for each kind of node: the rule and its listener.
#[derive(Default)]
struct ByTag {
    /// In the order in which they are registered.
    registered: Vec<(NodeTags, u16, u16)>,
    /// By `NodeTags::index_of`: where those for the kind start in `listeners`. One more than there are kinds.
    starts: Vec<u16>,
    listeners: Vec<(u16, u16)>,
    tags: NodeTags,
}

impl ByTag {
    fn finish(&mut self) {
        self.starts = vec![0; NodeTags::COUNT + 1];
        for &(tags, ..) in &self.registered {
            self.tags = self.tags | tags;
            tags.indices().for_each(|index| self.starts[index as usize + 1] += 1);
        }
        for index in 0..NodeTags::COUNT {
            self.starts[index + 1] += self.starts[index];
        }
        let mut next = self.starts.clone();
        self.listeners = vec![(0, 0); self.starts[NodeTags::COUNT] as usize];
        for &(tags, rule, entry) in &self.registered {
            for index in tags.indices() {
                self.listeners[next[index as usize] as usize] = (rule, entry);
                next[index as usize] += 1;
            }
        }
    }

    #[inline]
    fn of(&self, node: Node) -> &[(u16, u16)] {
        let index = NodeTags::index_of(node) as usize;
        &self.listeners[self.starts[index] as usize..self.starts[index + 1] as usize]
    }
}

/// Calls the listeners that depend on the order of the nodes.
struct Walk<'w, 'r, 'a> {
    running: &'w mut [Box<dyn Running<'a> + 'r>],
    enter: ByTag,
    exit: ByTag,
    /// By `event_index`.
    code_path: [Vec<(u16, u16)>; EVENTS],
}

impl<'a> Walk<'_, '_, 'a> {
    #[inline]
    fn enter(&mut self, node: Node<'a>) {
        for &(rule, entry) in self.enter.of(node) {
            self.running[rule as usize].call(entry, node);
        }
    }

    #[inline]
    fn exit(&mut self, node: Node<'a>) {
        for &(rule, entry) in self.exit.of(node) {
            self.running[rule as usize].call(entry, node);
        }
    }

    #[inline]
    fn event(&mut self, event: Event<'a>) {
        for &(rule, entry) in &self.code_path[event_index(&event)] {
            self.running[rule as usize].code_path_event(entry, event);
        }
    }
}

/// Enters and leaves the nodes that are listened for, without walking: the nodes of a file nest, so their spans determine the order.
/// Only the nodes of the kinds that are listened for are collected, from the vectors they are in, and sorted. The cost depends on
/// how many of those there are, not on the size of the file.
fn walk_listened<'a>(file: &'a File<'a>, walk: &mut Walk<'_, '_, 'a>) {
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
    file.every_node_of(walk.enter.tags | walk.exit.tags, |node| {
        let span = node.span();
        found.push(Found {
            start: span.start,
            end: span.end,
            rank: rank(node),
            node,
        });
    });
    found.sort_unstable_by_key(|it| (it.start, std::cmp::Reverse(it.end), it.rank));

    // The nodes that have been entered and not left, each with its end.
    let mut open: Vec<(u32, Node<'a>)> = Vec::new();
    for it in &found {
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
        Missing, Ident, PrivateIdentifier, This, Super, Null, True, False, Number, String, BigInt, Regex, Template,
        TaggedTemplate, Array, Object, Fn, Class, Dot, Index, Call, New, Unary, Binary, Assign, Cond, Spread, Await, Yield, As,
        Satisfies, AsConst, NonNull, Instantiation, Jsx, ImportCall, ImportMeta, NewTarget,
    ]
};

// ───────────────────────────── a file ─────────────────────────────

/// A rule that is enabled for a file.
#[derive(Copy, Clone)]
pub struct Enabled<'r> {
    pub rule: &'r dyn AnyRule,
    pub severity: Severity,
}

/// Runs `rules` on `file`. What they report is sorted by position. `Diagnostic::rule` is an index
/// into `rules`.
///
/// `wants_fixes`: whether the fixes and suggestions are going to be read.
pub fn run<'a>(file: &'a File<'a>, rules: &[Enabled<'_>], wants_fixes: bool) -> Vec<Diagnostic> {
    file.sink.wants_fixes.set(wants_fixes);
    run_rules(file, rules);
    let mut diagnostics = file.sink.diagnostics.take();
    // ESLint sorts by line and column alone, which leaves what starts at the same place in the order it was reported: for a
    // listener that is called on entering a node, the outer node first.
    diagnostics.sort_by_key(|it| (it.span.start, std::cmp::Reverse(it.span.end), it.rule));
    diagnostics
}

fn run_rules<'r, 'a: 'r>(file: &'a File<'a>, rules: &'r [Enabled<'r>]) {
    let has_types = file.types.is_some();
    let mut running: Vec<Box<dyn Running<'a> + 'r>> = Vec::with_capacity(rules.len());
    for (i, enabled) in rules.iter().enumerate() {
        if enabled.severity == Severity::Off || enabled.rule.meta().requires_types && !has_types {
            continue;
        }
        running.extend(enabled.rule.start(Start {
            file,
            rule: i as u16,
            severity: enabled.severity,
        }));
    }

    for rule in &mut running {
        rule.run_unordered();
    }

    let (mut enter, mut exit) = (ByTag::default(), ByTag::default());
    let mut code_path: [Vec<(u16, u16)>; EVENTS] = Default::default();
    for (i, rule) in running.iter().enumerate() {
        rule.listeners_of_walk(&mut |listener| match listener {
            WalkListener::Enter(tags, entry) => enter.registered.push((tags, i as u16, entry)),
            WalkListener::Exit(tags, entry) => exit.registered.push((tags, i as u16, entry)),
            WalkListener::CodePath(event, entry) => code_path[event].push((i as u16, entry)),
        });
    }
    let has_code_paths = code_path.iter().any(|listeners| !listeners.is_empty());
    if has_code_paths || !enter.registered.is_empty() || !exit.registered.is_empty() {
        enter.finish();
        exit.finish();
        let mut listeners = Walk {
            running: &mut running,
            enter,
            exit,
            code_path,
        };
        if has_code_paths {
            for step in steps(file, listeners.enter.tags, listeners.exit.tags) {
                match step {
                    Step::Enter(node) => listeners.enter(node),
                    Step::Exit(node) => listeners.exit(node),
                    Step::Event(event) => listeners.event(event),
                }
            }
        } else {
            walk_listened(file, &mut listeners);
        }
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
    };
}
