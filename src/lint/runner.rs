//! Runs rules on a file.

use crate::ast::walk::{Visitor, walk};
use crate::ast::{
    Case, Class, EnumMember, ExportSpec, Expr, ExprTag, File, Func, Handle, ImportSpec, Member,
    Node, Param, Pat, PatElem, PatProp, PatTag, Prop, Stmt, StmtTag, TupleElem, TypeNode, TypeParam, TypeTag, VarDecl,
};
use crate::code_path::{Analyzer, Event};
use crate::context::{Cx, Diagnostic, Severity};
use crate::options::Options;
use crate::rule::{Entry, Listeners, Meta, NodeTags, Rule};
use bun_sema::bind::{FnOwner, MemberOwner, Parent, PatParent};
use std::cell::OnceCell;

// ───────────────────────────── the nodes of a file, by kind ─────────────────────────────

/// Indices into one vector of the HIR, grouped by the kind of the node.
pub(crate) struct Grouped<const KINDS: usize> {
    ids: Vec<u32>,
    /// Where each kind starts in `ids`. One more than there are kinds.
    starts: Vec<u32>,
}

impl<const KINDS: usize> Grouped<KINDS> {
    /// `kind_of(i)`: the kind of the node at `i`, or `None` to leave it out.
    fn new(len: usize, kind_of: impl Fn(usize) -> Option<usize>) -> Self {
        let mut starts = vec![0u32; KINDS + 1];
        for i in 0..len {
            if let Some(kind) = kind_of(i) {
                starts[kind + 1] += 1;
            }
        }
        for kind in 0..KINDS {
            starts[kind + 1] += starts[kind];
        }
        let mut next = starts.clone();
        let mut ids = vec![0u32; starts[KINDS] as usize];
        for i in 0..len {
            if let Some(kind) = kind_of(i) {
                ids[next[kind] as usize] = i as u32;
                next[kind] += 1;
            }
        }
        Grouped { ids, starts }
    }

    #[inline]
    fn of(&self, kind: usize) -> &[u32] {
        &self.ids[self.starts[kind] as usize..self.starts[kind + 1] as usize]
    }
}

/// The expressions, statements, types and patterns of a file by kind, each grouped the first time a rule listens for one. Left
/// out are the nodes that are not part of the tree, which the parser leaves behind where it has backtracked, and those that are
/// synthesized from JSDoc comments.
#[derive(Default)]
pub(crate) struct ByKind {
    exprs: OnceCell<Grouped<{ ExprTag::COUNT }>>,
    stmts: OnceCell<Grouped<{ StmtTag::COUNT }>>,
    types: OnceCell<Grouped<{ TypeTag::COUNT }>>,
    pats: OnceCell<Grouped<{ PatTag::COUNT }>>,
}

impl File<'_> {
    #[inline]
    fn by_kind(&self) -> &ByKind {
        self.lazy.by_kind.get_or_init(ByKind::default)
    }

    #[inline]
    fn is_written(&self, pos: u32) -> bool {
        !self.has_synthetic_nodes() || !self.is_in_jsdoc(pos)
    }

    fn exprs_of(&self, tag: ExprTag) -> &[u32] {
        let (hir, bound) = (&self.hir, &self.bound);
        let grouped = self.by_kind().exprs.get_or_init(|| {
            Grouped::new(hir.exprs.len(), |i| {
                let is_reached = !matches!(bound.expr_parent.get(i), None | Some(Parent::None));
                (is_reached && self.is_written(hir.exprs[i].pos)).then(|| hir.exprs[i].kind.tag() as usize)
            })
        });
        grouped.of(tag as usize)
    }

    fn stmts_of(&self, tag: StmtTag) -> &[u32] {
        let (hir, bound) = (&self.hir, &self.bound);
        let grouped = self.by_kind().stmts.get_or_init(|| {
            Grouped::new(hir.stmts.len(), |i| {
                let is_reached = !matches!(bound.stmt_parent.get(i), None | Some(Parent::None));
                (is_reached && self.is_written(hir.stmts[i].start)).then(|| StmtTag::of(&hir.stmts[i].kind) as usize)
            })
        });
        grouped.of(tag as usize)
    }

    fn types_of(&self, tag: TypeTag) -> &[u32] {
        let (hir, bound) = (&self.hir, &self.bound);
        let grouped = self.by_kind().types.get_or_init(|| {
            Grouped::new(hir.types.len(), |i| {
                let is_reached = bound.type_scope.get(i).is_some_and(|scope| scope.is_some());
                (is_reached && self.is_written(hir.types[i].pos)).then(|| TypeTag::of(&hir.types[i].kind) as usize)
            })
        });
        grouped.of(tag as usize)
    }

    fn pats_of(&self, tag: PatTag) -> &[u32] {
        let (hir, bound) = (&self.hir, &self.bound);
        let grouped = self.by_kind().pats.get_or_init(|| {
            Grouped::new(hir.pats.len(), |i| {
                let is_reached = !matches!(bound.pat_parent.get(i), None | Some(PatParent::None));
                (is_reached && self.is_written(hir.pats[i].pos)).then(|| PatTag::of(&hir.pats[i].kind) as usize)
            })
        });
        grouped.of(tag as usize)
    }
}

/// Declares `File::$method`, which calls a function with every `$handle` of the file that is part of the tree.
macro_rules! every {
    ($($method:ident $handle:ident $field:ident |$hir:ident, $bound:ident, $i:ident| $is_reached:expr;)*) => {
        impl<'a> File<'a> {
            $(
                #[inline]
                fn $method(&'a self, mut visit: impl FnMut($handle<'a>)) {
                    let ($hir, $bound) = (&self.hir, &self.bound);
                    for $i in 0..$hir.$field.len() {
                        let it = <$handle as Handle>::from_raw(self, $i as u32);
                        if $is_reached && !it.is_synthetic() {
                            visit(it);
                        }
                    }
                }
            )*
        }
    };
}

every! {
    every_func Func fns |hir, bound, i| bound.fns.get(i).is_some_and(|f| f.owner != FnOwner::None);
    every_class Class classes |hir, bound, i| bound.class_scope.get(i).is_some_and(|scope| scope.is_some());
    every_member Member members |hir, bound, i| !matches!(bound.member_owner.get(i), None | Some(MemberOwner::None));
    every_prop Prop props |hir, bound, i| bound.prop_owner.get(i).is_some_and(|owner| owner.is_some());
    every_param Param params |hir, bound, i| bound.param_fn.get(i).is_some_and(|f| f.is_some());
    every_type_param TypeParam type_params |hir, bound, i| bound.type_param_scope.get(i).is_some_and(|scope| scope.is_some());
    every_var_decl VarDecl var_decls |hir, bound, i| bound.var_stmt.get(i).is_some_and(|s| s.is_some());
    every_case Case cases |hir, bound, i| bound.case_stmt.get(i).is_some_and(|s| s.is_some());
    every_enum_member EnumMember enum_members |hir, _bound, _i| true;
    every_import_spec ImportSpec import_specs |hir, _bound, _i| true;
    every_export_spec ExportSpec export_specs |hir, _bound, _i| true;
    every_tuple_elem TupleElem tuple_elems |hir, _bound, _i| true;
    every_pat_prop PatProp pat_props |hir, bound, i| {
        !matches!(bound.pat_parent.get(hir.pat_props[i].value.idx()), None | Some(PatParent::None))
    };
    every_pat_elem PatElem pat_elems |hir, bound, i| {
        !matches!(bound.pat_parent.get(hir.pat_elems[i].pat.idx()), None | Some(PatParent::None))
    };
}

// ───────────────────────────── a rule, whatever its type ─────────────────────────────

/// A [`Rule`] with its options, whatever its type.
pub trait AnyRule: Send + Sync {
    fn meta(&self) -> &'static Meta;

    #[doc(hidden)]
    fn start<'r, 'a: 'r>(&'r self, start: Start<'a>) -> Box<dyn Running<'a> + 'r>;
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

    fn start<'r, 'a: 'r>(&'r self, start: Start<'a>) -> Box<dyn Running<'a> + 'r> {
        let mut on = Listeners::new();
        let state = self.register(&mut on, start.file);
        Box::new(Run {
            rule: self,
            entries: on.entries,
            cx: Cx {
                state,
                file: start.file,
                rule: start.rule,
                severity: start.severity,
            },
        })
    }
}

/// How a rule is found by its name and made from its options.
#[derive(Copy, Clone)]
pub struct RuleEntry {
    pub meta: &'static Meta,
    pub build: fn(&Options) -> Box<dyn AnyRule>,
}

impl RuleEntry {
    pub const fn of<R: Rule>() -> RuleEntry {
        RuleEntry {
            meta: &R::META,
            build: |options| Box::new(R::new(options)),
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
    CodePath(u16),
}

struct Run<'r, 'a, R: Rule> {
    rule: &'r R,
    entries: Vec<Entry<'a, R>>,
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
                Entry::Symbols(listener) => {
                    for symbol in file.symbols() {
                        listener(rule, symbol, cx);
                    }
                }
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
                Entry::CodePathStart(_)
                | Entry::CodePathEnd(_)
                | Entry::SegmentStart(_)
                | Entry::SegmentEnd(_)
                | Entry::UnreachableSegmentStart(_)
                | Entry::UnreachableSegmentEnd(_)
                | Entry::SegmentLoop(_) => add(WalkListener::CodePath(i as u16)),
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

/// Calls the listeners that depend on the order of the nodes.
struct Walk<'w, 'r, 'a> {
    running: &'w mut [Box<dyn Running<'a> + 'r>],
    /// By `NodeTags::index_of`: the rule and its listener.
    enter: Vec<Vec<(u16, u16)>>,
    exit: Vec<Vec<(u16, u16)>>,
    code_path: Vec<(u16, u16)>,
    analyzer: Option<Analyzer<'a>>,
}

impl<'a> Walk<'_, '_, 'a> {
    fn analyze(
        &mut self,
        node: Node<'a>,
        step: fn(&mut Analyzer<'a>, Node<'a>, &mut dyn FnMut(Event<'a>)),
    ) {
        let Some(analyzer) = &mut self.analyzer else {
            return;
        };
        let (running, listeners) = (&mut *self.running, &self.code_path);
        step(analyzer, node, &mut |event| {
            for &(rule, entry) in listeners {
                running[rule as usize].code_path_event(entry, event);
            }
        });
    }
}

impl<'a> Visitor<'a> for Walk<'_, '_, 'a> {
    fn enter(&mut self, node: Node<'a>) {
        self.analyze(node, Analyzer::enter);
        for &(rule, entry) in &self.enter[NodeTags::index_of(node) as usize] {
            self.running[rule as usize].call(entry, node);
        }
    }

    fn exit(&mut self, node: Node<'a>) {
        self.analyze(node, Analyzer::before_exit);
        for &(rule, entry) in &self.exit[NodeTags::index_of(node) as usize] {
            self.running[rule as usize].call(entry, node);
        }
        self.analyze(node, Analyzer::after_exit);
    }
}

/// What `walk` does for a `Walk` without code paths, without walking: the nodes of a file nest, so their spans determine the order.
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
    let mut add = |node: Node<'a>| {
        let span = node.span();
        found.push(Found {
            start: span.start,
            end: span.end,
            rank: rank(node),
            node,
        });
    };
    let is_listened = |tags: NodeTags| {
        (0..NodeTags::COUNT).any(|i| tags.has_index(i as u32) && !(walk.enter[i].is_empty() && walk.exit[i].is_empty()))
    };
    for tag in EXPR_TAGS {
        if is_listened(tag.into()) {
            file.exprs_of(tag).iter().for_each(|&id| add(Node::Expr(Expr::from_raw(file, id))));
        }
    }
    for tag in StmtTag::ALL {
        if is_listened(tag.into()) {
            file.stmts_of(tag).iter().for_each(|&id| add(Node::Stmt(Stmt::from_raw(file, id))));
        }
    }
    for tag in TypeTag::ALL {
        if is_listened(tag.into()) {
            file.types_of(tag).iter().for_each(|&id| add(Node::Type(TypeNode::from_raw(file, id))));
        }
    }
    if is_listened(NodeTags::PAT) {
        for tag in PatTag::ALL {
            file.pats_of(tag).iter().for_each(|&id| add(Node::Pat(Pat::from_raw(file, id))));
        }
    }
    macro_rules! sorts {
        ($($tags:ident $every:ident $variant:ident;)*) => {
            $(if is_listened(NodeTags::$tags) {
                file.$every(|it| add(Node::$variant(it)));
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
    if is_listened(NodeTags::FILE) {
        add(Node::File(file));
    }
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

const EXPR_TAGS: [ExprTag; ExprTag::COUNT] = {
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
        running.push(enabled.rule.start(Start {
            file,
            rule: i as u16,
            severity: enabled.severity,
        }));
    }

    for rule in &mut running {
        rule.run_unordered();
    }

    let (mut enter, mut exit): (Vec<Vec<(u16, u16)>>, Vec<Vec<(u16, u16)>>) = (Vec::new(), Vec::new());
    let mut code_path = Vec::new();
    let mut needs_walk = false;
    for (i, rule) in running.iter().enumerate() {
        rule.listeners_of_walk(&mut |listener| {
            if !needs_walk {
                needs_walk = true;
                enter.resize(NodeTags::COUNT, Vec::new());
                exit.resize(NodeTags::COUNT, Vec::new());
            }
            let (table, tags, entry) = match listener {
                WalkListener::Enter(tags, entry) => (&mut enter, tags, entry),
                WalkListener::Exit(tags, entry) => (&mut exit, tags, entry),
                WalkListener::CodePath(entry) => return code_path.push((i as u16, entry)),
            };
            for (index, listeners) in table.iter_mut().enumerate() {
                if tags.has_index(index as u32) {
                    listeners.push((i as u16, entry));
                }
            }
        });
    }
    if needs_walk {
        let analyzer = (!code_path.is_empty()).then(|| Analyzer::new(file));
        let mut listeners = Walk {
            running: &mut running,
            enter,
            exit,
            code_path,
            analyzer,
        };
        // The analysis of code paths looks at every node.
        match listeners.analyzer.is_some() {
            true => walk(file, &mut listeners),
            false => walk_listened(file, &mut listeners),
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
