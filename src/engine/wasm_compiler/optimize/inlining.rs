//! Decides which calls are replaced by the body of the callee.

use core::cmp::Reverse;
use core::convert::Infallible;
use core::ops::Range;
use std::collections::BinaryHeap;

use bun_engine_wasm_format::{
    CodeIndex, FuncIndex, FunctionFlags, Module, TableIndex, TypeIndex, Visit, VisitControl,
    VisitMemory, VisitNumeric, VisitReference, VisitVariable, VisitVector,
};

use super::feedback::{Feedback, InliningBudget};

const MAX_DEPTH: u8 = 7;
const MAX_COUNT: u32 = 60;
const MAX_CALLEE_SIZE: u32 = 500;
const MAX_CALLEE_LOCALS: u32 = 500;
const TINY_SIZE: u32 = 12;
const ALLOWANCE_FOR_TINY: u32 = 100;
const SAVED_PER_CALL: u32 = 6;
const LEAST_BUDGET: f32 = 50.0;
const LEAST_GROWTH_FACTOR: f32 = 1.4;
const LEAST_SCORE: f32 = 0.0001;
const MOST_CALLS_PER_HIT: u32 = 10;
const LEAST_CALLS_PER_RARE_MISS: u32 = 20;
const NONE: u32 = u32::MAX;

/// A function at the end of a chain of calls.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Node(u32);

impl Node {
    pub(super) const ROOT: Self = Self(0);
}

#[derive(Clone, Copy)]
pub(super) struct NodeData {
    pub(super) code: CodeIndex,
    pub(super) is_inlined: bool,
    /// How often the function was entered, if it is inlined.
    pub(super) entries: u32,
    /// A tail call starts it over.
    pub(super) repeats: bool,
    /// While its body is translated, the position of that among the blocks.
    pub(super) body: u32,
    pub(super) first_local: u32,
    /// Its position among the inline frames, once it has one.
    pub(super) frame: Option<u32>,
    caller: u32,
    replaces_caller: bool,
    depth: u8,
    first_site: u32,
    /// For each entry to the root.
    calls: f32,
}

struct SiteData {
    /// The nodes for the functions that the call may reach.
    callees: Range<u32>,
    rarely_misses: bool,
    count: u32,
}

#[derive(Clone, Copy)]
enum Call {
    Unreachable,
    Direct { func: FuncIndex, is_tail: bool },
    Indirect { ty: TypeIndex, is_tail: bool },
}

#[derive(Default)]
pub(super) struct Inlining {
    nodes: Vec<NodeData>,
    sites: Vec<SiteData>,
    calls: Vec<Call>,
    queue: BinaryHeap<(u32, Reverse<u32>, Reverse<u32>)>,
}

impl core::ops::Index<Node> for Inlining {
    type Output = NodeData;

    fn index(&self, node: Node) -> &NodeData {
        &self.nodes[node.0 as usize]
    }
}

impl core::ops::IndexMut<Node> for Inlining {
    fn index_mut(&mut self, node: Node) -> &mut NodeData {
        &mut self.nodes[node.0 as usize]
    }
}

impl Inlining {
    /// Inlines nothing.
    pub(super) fn reset(&mut self, root: CodeIndex) {
        self.nodes.clear();
        self.sites.clear();
        self.queue.clear();
        self.add(root, NONE, false, 1.0);
    }

    fn add(&mut self, code: CodeIndex, caller: u32, replaces_caller: bool, calls: f32) {
        let depth = (self.nodes.get(caller as usize)).map_or(0, |caller| caller.depth + 1);
        self.nodes.push(NodeData {
            code,
            is_inlined: false,
            entries: 0,
            repeats: false,
            body: NONE,
            first_local: 0,
            frame: None,
            caller,
            replaces_caller,
            depth,
            first_site: NONE,
            calls,
        });
    }

    /// With `first_site`, the root is not entered at its start, and the calls before that one do not run.
    pub(super) fn decide(
        &mut self,
        module: &Module,
        feedback: &dyn Feedback,
        first_site: Option<u32>,
    ) {
        let size_of = |code| module.body_span(code).len;
        let (budget, root_size) = (feedback.inlining_budget(), size_of(self.nodes[0].code));
        let limit = limit(budget, root_size);
        let (mut count, mut added) = (1, 0u32);
        self.expand(module, feedback, 0, first_site);
        while count < MAX_COUNT
            && let Some((score, Reverse(code), Reverse(node))) = self.queue.pop()
        {
            let size = size_of(CodeIndex(code));
            let counted = if size < TINY_SIZE {
                added.saturating_sub(ALLOWANCE_FOR_TINY)
            } else if f32::from_bits(score) < LEAST_SCORE {
                continue;
            } else {
                added
            };
            if (root_size + counted + size) as f32 >= limit {
                continue;
            }
            self.expand(module, feedback, node, first_site);
            count += 1;
            added += size.saturating_sub(SAVED_PER_CALL);
        }
    }

    fn expand(
        &mut self,
        module: &Module,
        feedback: &dyn Feedback,
        node: u32,
        first_site: Option<u32>,
    ) {
        let data = &mut self.nodes[node as usize];
        (data.is_inlined, data.entries) = (true, feedback.entry_count(data.code));
        let NodeData {
            code,
            depth,
            calls,
            entries,
            ..
        } = *data;
        let facts = module.facts(code);
        if facts.call_count == 0 {
            return;
        }
        if entries == 0 && !facts.flags.contains(FunctionFlags::HAS_TAIL_CALL) {
            return;
        }
        self.calls.clear();
        (self.calls).resize(facts.call_count as usize, Call::Unreachable);
        let Ok(()) = (module.body(code).driver()).run(&mut CallScan(&mut self.calls));

        self.nodes[node as usize].first_site = self.sites.len() as u32;
        let skipped = first_site.filter(|_| node == 0).unwrap_or(0);
        let types = module.types();
        for site in 0..facts.call_count {
            let first = self.nodes.len() as u32;
            let call = self.calls[site as usize];
            let mut rarely_misses = true;
            let seen = feedback.call(code, site);
            let mut add = |callee: CodeIndex, count: u32, is_tail: bool| {
                let id = self.nodes.len() as u32;
                let calls = calls * count as f32 / entries.max(1) as f32;
                self.add(callee, node, is_tail, calls);
                let repeated = (self.replaced_by(Node(id)))
                    .find(|&known| self[known].code == callee)
                    .filter(|&known| known != Node::ROOT || first_site.is_none());
                let size = module.body_span(callee).len;
                if let Some(repeated) = repeated {
                    self[repeated].repeats = true;
                } else if entries != 0
                    && depth < MAX_DEPTH
                    && size <= MAX_CALLEE_SIZE
                    && module.facts(callee).local_count <= MAX_CALLEE_LOCALS
                {
                    let score = (calls / size as f32).to_bits();
                    self.queue.push((score, Reverse(callee.0), Reverse(id)));
                }
            };
            match call {
                _ if site < skipped => {}
                Call::Unreachable => {}
                Call::Direct { func, is_tail } => {
                    if let Some(callee) = module.code_index(func) {
                        add(callee, seen.count, is_tail);
                    }
                }
                Call::Indirect { ty, is_tail } => {
                    let mut others = seen.count;
                    for (callee, count) in seen.targets {
                        let actual = module.func_type_index(module.func_index(callee));
                        if count >= seen.count / MOST_CALLS_PER_HIT
                            && types.is_heap_subtype(types.heap_type(actual), types.heap_type(ty))
                        {
                            add(callee, count, is_tail);
                            others = others.saturating_sub(count);
                        }
                    }
                    rarely_misses = others <= seen.count / LEAST_CALLS_PER_RARE_MISS;
                }
            }
            self.sites.push(SiteData {
                callees: first..self.nodes.len() as u32,
                rarely_misses,
                count: seen.count,
            });
        }
    }

    /// The functions that the call is known to reach.
    pub(super) fn callees(
        &self,
        caller: Node,
        site: u32,
    ) -> impl ExactSizeIterator<Item = Node> + use<> {
        let site = self.site(caller, site);
        site.map_or(0..0, |site| site.callees.clone()).map(Node)
    }

    /// Whether the call seldom reaches another function.
    pub(super) fn rarely_misses(&self, caller: Node, site: u32) -> bool {
        self.site(caller, site).is_some_and(|it| it.rarely_misses)
    }

    /// How often the call was made, if that is known.
    pub(super) fn count(&self, caller: Node, site: u32) -> Option<u32> {
        self.site(caller, site).map(|site| site.count)
    }

    fn site(&self, caller: Node, site: u32) -> Option<&SiteData> {
        let first = self[caller].first_site;
        (first != NONE).then(|| &self.sites[(first + site) as usize])
    }

    /// The callers whose place `node` takes by tail calls, the last first.
    pub(super) fn replaced_by(&self, node: Node) -> impl Iterator<Item = Node> {
        let replaced = |&node: &Node| {
            let data = &self[node];
            data.replaces_caller.then_some(Node(data.caller))
        };
        core::iter::successors(replaced(&node), replaced)
    }
}

fn limit(budget: InliningBudget, root_size: u32) -> f32 {
    let for_small = (budget.growth_factor * root_size as f32).max(LEAST_BUDGET);
    let for_large = (LEAST_GROWTH_FACTOR * root_size as f32).max(budget.cap);
    for_small.min(for_large)
}

struct CallScan<'a>(&'a mut [Call]);

impl CallScan<'_> {
    fn note(&mut self, site: u32, call: Call) -> Result<(), Infallible> {
        self.0[site as usize] = call;
        Ok(())
    }
}

impl Visit for CallScan<'_> {
    type Error = Infallible;

    #[inline(always)]
    fn unhandled(&mut self) -> Result<(), Infallible> {
        Ok(())
    }
}

impl VisitControl for CallScan<'_> {
    fn call(&mut self, func: FuncIndex, site: u32) -> Result<(), Infallible> {
        let is_tail = false;
        self.note(site, Call::Direct { func, is_tail })
    }

    fn call_indirect(&mut self, ty: TypeIndex, _: TableIndex, site: u32) -> Result<(), Infallible> {
        self.call_ref(ty, site)
    }

    fn call_ref(&mut self, ty: TypeIndex, site: u32) -> Result<(), Infallible> {
        let is_tail = false;
        self.note(site, Call::Indirect { ty, is_tail })
    }

    fn return_call(&mut self, func: FuncIndex, site: u32) -> Result<(), Infallible> {
        let is_tail = true;
        self.note(site, Call::Direct { func, is_tail })
    }

    fn return_call_indirect(
        &mut self,
        ty: TypeIndex,
        _: TableIndex,
        site: u32,
    ) -> Result<(), Infallible> {
        self.return_call_ref(ty, site)
    }

    fn return_call_ref(&mut self, ty: TypeIndex, site: u32) -> Result<(), Infallible> {
        let is_tail = true;
        self.note(site, Call::Indirect { ty, is_tail })
    }
}

impl VisitVariable for CallScan<'_> {}
impl VisitNumeric for CallScan<'_> {}
impl VisitMemory for CallScan<'_> {}
impl VisitReference for CallScan<'_> {}
impl VisitVector for CallScan<'_> {}
