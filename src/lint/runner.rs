//! Runs rules on a file.

use crate::ast::walk::{Visitor, walk};
use crate::ast::{
    Case, Class, EnumMember, ExportSpec, Expr, ExprTag, File, Func, Handle, ImportSpec, Member,
    Node, Param, Pat, PatTag, Prop, Stmt, StmtTag, TypeNode, TypeParam, TypeTag, VarDecl,
};
use crate::code_path::{Analyzer, Event};
use crate::context::{Cx, Diagnostic, Severity};
use crate::options::Options;
use crate::rule::{Entry, Listeners, Meta, NodeTags, Rule};
use bun_sema::bind::{FnOwner, MemberOwner, Parent, PatParent};

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

/// The expressions, statements, types and patterns of a file by kind. Left out are the nodes that
/// are not part of the tree, which the parser leaves behind where it has backtracked, and those
/// that are synthesized from JSDoc comments.
pub(crate) struct ByKind {
    exprs: Grouped<{ ExprTag::COUNT }>,
    stmts: Grouped<{ StmtTag::COUNT }>,
    types: Grouped<{ TypeTag::COUNT }>,
    pats: Grouped<{ PatTag::COUNT }>,
}

impl ByKind {
    fn new(file: &File) -> ByKind {
        let (hir, bound) = (&file.hir, &file.bound);
        let hides = file.has_synthetic_nodes();
        let is_written = |pos: u32| !hides || !file.is_in_jsdoc(pos);
        ByKind {
            exprs: Grouped::new(hir.exprs.len(), |i| {
                let is_reached = !matches!(bound.expr_parent.get(i), None | Some(Parent::None));
                (is_reached && is_written(hir.exprs[i].pos)).then(|| hir.exprs[i].kind.tag() as usize)
            }),
            stmts: Grouped::new(hir.stmts.len(), |i| {
                let is_reached = !matches!(bound.stmt_parent.get(i), None | Some(Parent::None));
                (is_reached && is_written(hir.stmts[i].start))
                    .then(|| StmtTag::of(&hir.stmts[i].kind) as usize)
            }),
            types: Grouped::new(hir.types.len(), |i| {
                let is_reached = bound.type_scope.get(i).is_some_and(|scope| scope.is_some());
                (is_reached && is_written(hir.types[i].pos))
                    .then(|| TypeTag::of(&hir.types[i].kind) as usize)
            }),
            pats: Grouped::new(hir.pats.len(), |i| {
                let is_reached = !matches!(bound.pat_parent.get(i), None | Some(PatParent::None));
                (is_reached && is_written(hir.pats[i].pos))
                    .then(|| PatTag::of(&hir.pats[i].kind) as usize)
            }),
        }
    }
}

impl File<'_> {
    fn by_kind(&self) -> &ByKind {
        self.lazy.by_kind.get_or_init(|| ByKind::new(self))
    }
}

// ───────────────────────────── a rule, whatever its type ─────────────────────────────

/// A [`Rule`] with its options, whatever its type.
pub trait AnyRule: Send + Sync {
    fn meta(&self) -> &'static Meta;

    #[doc(hidden)]
    fn start<'a>(&'a self, start: Start<'a>) -> Box<dyn Running<'a> + 'a>;
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

    fn start<'a>(&'a self, start: Start<'a>) -> Box<dyn Running<'a> + 'a> {
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

struct Run<'a, R: Rule> {
    rule: &'a R,
    entries: Vec<Entry<'a, R>>,
    cx: Cx<'a, R>,
}

impl<'a, R: Rule> Running<'a> for Run<'a, R> {
    fn run_unordered(&mut self) {
        let (rule, cx) = (self.rule, &mut self.cx);
        let file = cx.file;
        let (hir, bound) = (&file.hir, &file.bound);
        // All of a vector, except what `is_reached` rejects.
        macro_rules! all {
            ($handle:ident, $field:ident, $listener:expr, |$i:ident| $is_reached:expr) => {
                for $i in 0..hir.$field.len() {
                    let it = <$handle as Handle>::from_raw(file, $i as u32);
                    if $is_reached && !it.is_synthetic() {
                        $listener(rule, it, cx);
                    }
                }
            };
        }
        for entry in &self.entries {
            match *entry {
                Entry::Exprs(tag, listener) => {
                    for &id in file.by_kind().exprs.of(tag as usize) {
                        listener(rule, Expr::from_raw(file, id), cx);
                    }
                }
                Entry::Stmts(tag, listener) => {
                    for &id in file.by_kind().stmts.of(tag as usize) {
                        listener(rule, Stmt::from_raw(file, id), cx);
                    }
                }
                Entry::Types(tag, listener) => {
                    for &id in file.by_kind().types.of(tag as usize) {
                        listener(rule, TypeNode::from_raw(file, id), cx);
                    }
                }
                Entry::Pats(tag, listener) => {
                    for &id in file.by_kind().pats.of(tag as usize) {
                        listener(rule, Pat::from_raw(file, id), cx);
                    }
                }
                Entry::Funcs(listener) => all!(Func, fns, listener, |i| {
                    bound.fns.get(i).is_some_and(|f| f.owner != FnOwner::None)
                }),
                Entry::Classes(listener) => all!(Class, classes, listener, |i| {
                    bound.class_scope.get(i).is_some_and(|scope| scope.is_some())
                }),
                Entry::Members(listener) => all!(Member, members, listener, |i| {
                    !matches!(bound.member_owner.get(i), None | Some(MemberOwner::None))
                }),
                Entry::Props(listener) => all!(Prop, props, listener, |i| {
                    bound.prop_owner.get(i).is_some_and(|owner| owner.is_some())
                }),
                Entry::Params(listener) => all!(Param, params, listener, |i| {
                    bound.param_fn.get(i).is_some_and(|f| f.is_some())
                }),
                Entry::TypeParams(listener) => all!(TypeParam, type_params, listener, |i| {
                    bound.type_param_scope.get(i).is_some_and(|scope| scope.is_some())
                }),
                Entry::VarDecls(listener) => all!(VarDecl, var_decls, listener, |i| {
                    bound.var_stmt.get(i).is_some_and(|s| s.is_some())
                }),
                Entry::Cases(listener) => all!(Case, cases, listener, |i| {
                    bound.case_stmt.get(i).is_some_and(|s| s.is_some())
                }),
                Entry::EnumMembers(listener) => all!(EnumMember, enum_members, listener, |_i| true),
                Entry::ImportSpecs(listener) => all!(ImportSpec, import_specs, listener, |_i| true),
                Entry::ExportSpecs(listener) => all!(ExportSpec, export_specs, listener, |_i| true),
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
struct Walk<'r, 'a> {
    running: &'r mut [Box<dyn Running<'a> + 'a>],
    /// By `NodeTags::index_of`: the rule and its listener.
    enter: Vec<Vec<(u16, u16)>>,
    exit: Vec<Vec<(u16, u16)>>,
    code_path: Vec<(u16, u16)>,
    analyzer: Option<Analyzer<'a>>,
}

impl<'a> Walk<'_, 'a> {
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

impl<'a> Visitor<'a> for Walk<'_, 'a> {
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
pub fn run<'a>(file: &'a File<'a>, rules: &'a [Enabled<'a>], wants_fixes: bool) -> Vec<Diagnostic> {
    file.sink.wants_fixes.set(wants_fixes);
    run_rules(file, rules);
    let mut diagnostics = file.sink.diagnostics.take();
    diagnostics.sort_by_key(|it| (it.span.start, it.span.end, it.rule));
    diagnostics
}

fn run_rules<'a>(file: &'a File<'a>, rules: &'a [Enabled<'a>]) {
    let has_types = file.types.is_some();
    let mut running: Vec<Box<dyn Running<'a> + 'a>> = Vec::with_capacity(rules.len());
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

    let mut enter = vec![Vec::new(); NodeTags::COUNT];
    let mut exit = vec![Vec::new(); NodeTags::COUNT];
    let mut code_path = Vec::new();
    let mut needs_walk = false;
    for (i, rule) in running.iter().enumerate() {
        rule.listeners_of_walk(&mut |listener| {
            needs_walk = true;
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
        walk(
            file,
            &mut Walk {
                running: &mut running,
                enter,
                exit,
                code_path,
                analyzer,
            },
        );
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
