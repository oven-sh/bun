use crate::declared::{Declared, DeclaredTable, Part, prim};
use crate::id::{FuncId, LayoutId, StrId, TyId, V};
use crate::ir::{
    BinOp, CoerceReason, Def, Func, Layout, LayoutKind, MethodKind, Op, Operation, Prediction,
    Program, Strs, Target, Term, UnOp, class_flags, func_flags, method_flags,
    single_function_flags,
};
use bun_sema::check::nullish_flow::{
    EdgesByNode, FlowScratch, FunctionNullishFlows, Jump, NO_JUMP, NULL, NullishEdges, Origin,
    SlotEvent, UNDEFINED, UNTYPED_OBJECT, Use, add_function_nullish_flows,
    callback_element_parameters, edges_by_node, propagate_nullish, reach_backward,
    reaching_stores_for_reads,
};
use bun_sema::util::{InParallel, for_each_mut};
use bun_threading::Guarded;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

const NULLISH: u8 = UNDEFINED | NULL;

pub(super) struct Nodes {
    values: Vec<u32>,
    pub(super) results: u32,
    pub(super) globals: u32,
    fields: Vec<u32>,
    produced: u32,
    pub(super) count: u32,
}

impl Nodes {
    pub(super) fn new(program: &Program) -> Nodes {
        let mut count = 0;
        let mut take = |many: usize| {
            let first = count;
            count += many as u32;
            first
        };
        let values = program
            .funcs
            .iter()
            .map(|func| take(func.values.len()))
            .collect();
        let results = take(program.funcs.len());
        let globals = take(program.globals.len());
        let fields = program
            .layouts
            .iter()
            .map(|layout| take(layout.fields.len()))
            .collect();
        let produced = take(2);
        Nodes {
            values,
            results,
            globals,
            fields,
            produced,
            count,
        }
    }
    pub(super) fn value(&self, func: usize, v: V) -> u32 {
        self.values[func] + v.idx() as u32
    }
    pub(super) fn result(&self, func: usize) -> u32 {
        self.results + func as u32
    }
    pub(super) fn field(&self, layout: LayoutId, field: u32) -> u32 {
        self.fields[layout.idx()] + field
    }
}

pub(super) fn strip_casts(func: &Func, mut v: V) -> V {
    while let Some(&Op::Coerce { value, why, .. }) = func.op(v)
        && why != CoerceReason::Coerce
    {
        v = value;
    }
    v
}

pub(super) fn targets_of(term: Option<&Term>) -> SmallVec<[&Target; 2]> {
    match term {
        Some(Term::Jump(target)) => SmallVec::from_iter([target]),
        Some(Term::Branch {
            then, otherwise, ..
        }) => SmallVec::from_iter([then, otherwise]),
        Some(Term::Switch { cases, default, .. }) => {
            cases.iter().map(|case| &case.1).chain([default]).collect()
        }
        Some(Term::Throw { unwind, .. }) => unwind.iter().collect(),
        Some(Term::Invoke { normal, unwind }) => SmallVec::from_iter([normal, unwind]),
        Some(Term::Return(_) | Term::Unreachable) | None => SmallVec::new(),
    }
}

fn is_unboxed_ty(program: &Program, ty: TyId) -> bool {
    ty.is_some()
        && ty != program.tys.anything
        && !program.tys.get(ty).has_objects()
        && program.tys.get(ty).prims & prim::CELLS == 0
        && !program.tys.get(ty).is_never()
}

fn unboxed_kinds(program: &Program, ty: TyId) -> impl Iterator<Item = u32> {
    let is_unboxed = is_unboxed_ty(program, ty);
    let has_numbers = is_unboxed
        && (program.tys.get(ty).prims & prim::NUMBER != 0 || program.tys.get(ty).ints.is_some());
    let has_booleans = is_unboxed && program.tys.get(ty).prims & prim::BOOLEAN != 0;
    has_numbers
        .then_some(0)
        .into_iter()
        .chain(has_booleans.then_some(1))
}

fn may_reach_program_code(program: &Program, func: &Func, v: V) -> bool {
    let may_be_program_object = |obj: V| {
        let ty = func.ty(obj);
        !matches!(func.op(strip_casts(func, obj)), Some(Op::FreeGet { .. }))
            && (ty.is_none()
                || ty == program.tys.anything
                || program.tys.get(ty).any_object
                || program
                    .tys
                    .get(ty)
                    .parts
                    .iter()
                    .any(|part| matches!(part, Part::Class(_))))
    };
    match func.op(v) {
        Some(&Op::Call { callee, .. }) => match func.op(strip_casts(func, callee)) {
            Some(Op::FreeGet { .. }) => false,
            Some(&Op::PropGet { obj, .. }) => may_be_program_object(obj),
            _ => true,
        },
        Some(&Op::CallMethod { obj, .. }) => may_be_program_object(obj),
        _ => false,
    }
}

struct Site {
    callees: SmallVec<[u32; 1]>,
    args: SmallVec<[(u32, TyId); 4]>,
    result: Option<u32>,
    is_engine_site: bool,
}

#[derive(Default)]
struct FunctionValueFlows {
    allocation_sites: Vec<(u32, FuncId)>,
    moves: Vec<(u32, u32)>,
    reads_from: Vec<(u32, u32)>,
    stand_ins: Vec<u32>,
    sites: Vec<Site>,
    leaks: Vec<u32>,
    left_out: Vec<u32>,
    handed: Vec<u32>,
}

const MAX_LINEAR_SEARCH: usize = 16;
const MEMO_MIN_MEMBERS: usize = 4;

mod node_state {
    pub(super) const LEAKS: u32 = 1;
    pub(super) const HAS_SITES: u32 = 1 << 1;
    pub(super) const HAS_ADDED_EDGES: u32 = 1 << 2;
    pub(super) const HAS_MORE_FUNCTIONS: u32 = 1 << 3;
    pub(super) const FLAG_BITS: u32 = 4;
}

#[derive(Default)]
struct FunctionSet {
    list: SmallVec<[FuncId; 1]>,
    crowded: FxHashSet<FuncId>,
}

impl FunctionSet {
    fn insert(&mut self, function: FuncId) -> bool {
        let is_new = if self.list.len() < MAX_LINEAR_SEARCH {
            !self.list.contains(&function)
        } else {
            if self.crowded.is_empty() {
                self.crowded.extend(self.list.iter().copied());
            }
            self.crowded.insert(function)
        };
        if is_new {
            self.list.push(function);
        }
        is_new
    }
}

type ShardedByNode<T> = Vec<Guarded<FxHashMap<u32, T>>>;

struct FunctionValues<'a> {
    program: &'a Program,
    nodes: &'a Nodes,
    leaving: &'a EdgesByNode,
    state: &'a [AtomicU32],
    sites: Vec<&'a Site>,
    sites_at: FxHashMap<u32, SmallVec<[u32; 1]>>,
    more_functions: ShardedByNode<FunctionSet>,
    added_edges: ShardedByNode<SmallVec<[u32; 2]>>,
    joined: Vec<Guarded<FxHashSet<(u32, FuncId)>>>,
    is_joined: Vec<AtomicBool>,
    has_escaped: Vec<AtomicBool>,
}

impl FunctionValues<'_> {
    const SHARDS: usize = 64;
    const HELPER_THREADS: usize = 3;

    fn for_each_function_at(&self, node: u32, mut visit: impl FnMut(FuncId)) {
        let here = self.state[node as usize].load(Ordering::Acquire);
        if let Some(first) = (here >> node_state::FLAG_BITS).checked_sub(1) {
            visit(FuncId(first));
        }
        if here & node_state::HAS_MORE_FUNCTIONS != 0
            && let Some(more) = self.more_functions[node as usize % FunctionValues::SHARDS]
                .lock()
                .get(&node)
        {
            more.list.iter().copied().for_each(visit);
        }
    }

    fn may_introduce(&self, given: TyId, taken: TyId) -> bool {
        let program = self.program;
        if !is_unboxed_ty(program, taken) || given.is_none() || given == program.tys.anything {
            return true;
        }
        let (given, taken) = (program.tys.get(given), program.tys.get(taken));
        let has_numbers = |it: &Declared| it.prims & prim::NUMBER != 0 || it.ints.is_some();
        given.prims & !prim::NULLISH == 0 && given.ints.is_none() && !given.has_objects()
            || has_numbers(given) && has_numbers(taken)
            || given.prims & taken.prims & prim::BOOLEAN != 0
    }

    fn propagate(&self, pending: Vec<(FuncId, u32)>, more: &mut NullishEdges) {
        let queue = super::WorkQueue::default();
        queue.share(pending.into_iter());
        let work = |found: &mut NullishEdges| {
            let mut worker = FunctionValueWorker {
                values: self,
                pending: Vec::new(),
                joins: Vec::new(),
                recently_visited: vec![0; FunctionValueWorker::RECENT_VISITS],
                more: NullishEdges::default(),
            };
            worker.run(&queue);
            *found = worker.more;
        };
        let mut found: Vec<NullishEdges> = (0..1 + FunctionValues::HELPER_THREADS)
            .map(|_| NullishEdges::default())
            .collect();
        let (own, of_helpers) = found.split_at_mut(1);
        std::thread::scope(|scope| {
            for found in of_helpers {
                scope.spawn(move || work(found));
            }
            work(&mut own[0]);
        });
        for mut found in found {
            more.edges.append(&mut found.edges);
            more.origins.append(&mut found.origins);
        }
    }
}

struct FunctionValueWorker<'a, 'b> {
    values: &'b FunctionValues<'a>,
    pending: Vec<(FuncId, u32)>,
    joins: Vec<(u32, u32)>,
    recently_visited: Vec<u64>,
    more: NullishEdges,
}

impl FunctionValueWorker<'_, '_> {
    const RECENT_VISITS: usize = 1 << 12;

    fn run(&mut self, queue: &super::WorkQueue<(FuncId, u32)>) {
        queue.join();
        loop {
            let Some((function, node)) = self.pending.pop() else {
                if queue.wait_for_work(&mut self.pending) {
                    continue;
                }
                return;
            };
            self.visit(function, node);
            if self.pending.len() > 1 && queue.has_idle_workers() {
                let shared = self.pending.len() / 2;
                queue.share(self.pending.drain(..shared));
            }
        }
    }

    fn escape(&mut self, function: FuncId) {
        let values = self.values;
        let mut gone: SmallVec<[FuncId; 4]> = SmallVec::from_slice(&[function]);
        while let Some(function) = gone.pop() {
            if !values.has_escaped[function.idx()].swap(true, Ordering::AcqRel) {
                let result = values.nodes.result(function.idx());
                values.state[result as usize].fetch_or(node_state::LEAKS, Ordering::AcqRel);
                values.for_each_function_at(result, |held| gone.push(held));
            }
        }
    }

    fn visit(&mut self, function: FuncId, node: u32) {
        use node_state::{FLAG_BITS, HAS_ADDED_EDGES, HAS_MORE_FUNCTIONS, HAS_SITES, LEAKS};
        let visit = u64::from(node) << 32 | u64::from(function.0 + 1);
        let recent = &mut self.recently_visited[(visit.wrapping_mul(0x9E37_79B9_7F4A_7C15)
            >> (64 - FunctionValueWorker::RECENT_VISITS.trailing_zeros()))
            as usize];
        if std::mem::replace(recent, visit) == visit {
            return;
        }
        let values = self.values;
        let (program, nodes, leaving) = (values.program, values.nodes, values.leaving);
        let cell = &values.state[node as usize];
        let mut known = cell.load(Ordering::Acquire);
        loop {
            match (known >> FLAG_BITS).checked_sub(1) {
                None => match cell.compare_exchange_weak(
                    known,
                    known | (function.0 + 1) << FLAG_BITS,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                ) {
                    Ok(_) => break,
                    Err(now) => known = now,
                },
                Some(first) if first == function.0 => return,
                Some(_) => {
                    if !values.more_functions[node as usize % FunctionValues::SHARDS]
                        .lock()
                        .entry(node)
                        .or_default()
                        .insert(function)
                    {
                        return;
                    }
                    known = cell.fetch_or(HAS_MORE_FUNCTIONS, Ordering::AcqRel);
                    break;
                }
            }
        }
        if known & LEAKS != 0 {
            self.escape(function);
        }
        for &number in (if known & HAS_SITES != 0 {
            values.sites_at.get(&node)
        } else {
            None
        })
        .into_iter()
        .flatten()
        {
            if !values.joined[number as usize % FunctionValues::SHARDS]
                .lock()
                .insert((number, function))
            {
                continue;
            }
            values.is_joined[number as usize].store(true, Ordering::Relaxed);
            let (site, called) = (
                values.sites[number as usize],
                &program.funcs[function.idx()],
            );
            let Some(entered) = called.blocks.first() else {
                continue;
            };
            let ahead = entered.params.len().saturating_sub(called.params.len());
            for (number, &parameter) in entered.params.iter().skip(ahead).enumerate() {
                let to = nodes.value(function.idx(), parameter);
                match site.args.get(number) {
                    Some(&(u32::MAX, _)) => {}
                    Some(&(from, given)) if values.may_introduce(given, called.params[number]) => {
                        self.joins.push((from, to))
                    }
                    Some(_) => {}
                    None => self.more.origins.push((to, UNDEFINED)),
                }
            }
            if let Some(result) = site
                .result
                .filter(|_| !called.has(func_flags::ASYNC | func_flags::GENERATOR))
            {
                self.joins.push((nodes.result(function.idx()), result));
            }
        }
        let pending = &mut self.pending;
        for (from, to) in self.joins.drain(..) {
            self.more.edges.push((from, to, UNDEFINED | UNTYPED_OBJECT));
            values.added_edges[from as usize % FunctionValues::SHARDS]
                .lock()
                .entry(from)
                .or_default()
                .push(to);
            values.state[from as usize].fetch_or(HAS_ADDED_EDGES, Ordering::AcqRel);
            values.for_each_function_at(from, |carried| pending.push((carried, to)));
        }
        pending.extend(
            leaving.other[leaving.at(node)]
                .iter()
                .filter(|&&to| {
                    values.state[to as usize].load(Ordering::Relaxed) >> FLAG_BITS != function.0 + 1
                })
                .map(|&to| (function, to)),
        );
        if cell.load(Ordering::Acquire) & HAS_ADDED_EDGES != 0 {
            pending.extend(
                values.added_edges[node as usize % FunctionValues::SHARDS]
                    .lock()
                    .get(&node)
                    .into_iter()
                    .flatten()
                    .map(|&to| (function, to)),
            );
        }
    }
}

fn propagate_function_values<'a>(
    program: &Program,
    nodes: &Nodes,
    leaving: impl FnOnce() -> &'a EdgesByNode,
    found: &[FunctionValueFlows],
    mut state: Vec<u32>,
) -> NullishEdges {
    use node_state::{HAS_ADDED_EDGES, HAS_SITES, LEAKS};
    let mut more = NullishEdges::default();
    let mut sites: Vec<&Site> = Vec::with_capacity(found.iter().map(|part| part.sites.len()).sum());
    let mut sites_at: FxHashMap<u32, SmallVec<[u32; 1]>> = FxHashMap::with_capacity_and_hasher(
        found
            .iter()
            .flat_map(|part| &part.sites)
            .map(|site| site.callees.len())
            .sum(),
        Default::default(),
    );
    let mut pending: Vec<(FuncId, u32)> =
        Vec::with_capacity(found.iter().map(|part| part.allocation_sites.len()).sum());
    for part in found {
        for site in &part.sites {
            for &callee in &site.callees {
                state[callee as usize] |= HAS_SITES;
                sites_at.entry(callee).or_default().push(sites.len() as u32);
            }
            sites.push(site);
        }
        pending.extend(
            part.allocation_sites
                .iter()
                .map(|&(node, function)| (function, node)),
        );
    }
    // SAFETY: an `AtomicU32` has the size, the alignment and the bit validity of a `u32`, and `state` stays mutably borrowed for as long as the atomics are in use.
    let state: &[AtomicU32] =
        unsafe { &*(std::ptr::from_mut::<[u32]>(&mut state[..]) as *const [AtomicU32]) };
    let mut values = FunctionValues {
        program,
        nodes,
        leaving: leaving(),
        state,
        is_joined: sites.iter().map(|_| AtomicBool::new(false)).collect(),
        sites,
        sites_at,
        more_functions: (0..FunctionValues::SHARDS)
            .map(|_| Guarded::new(FxHashMap::default()))
            .collect(),
        added_edges: (0..FunctionValues::SHARDS)
            .map(|_| Guarded::new(FxHashMap::default()))
            .collect(),
        joined: (0..FunctionValues::SHARDS)
            .map(|_| Guarded::new(FxHashSet::default()))
            .collect(),
        has_escaped: program
            .funcs
            .iter()
            .map(|_| AtomicBool::new(false))
            .collect(),
    };
    loop {
        values.propagate(std::mem::take(&mut pending), &mut more);
        for number in 0..values.sites.len() {
            let site = values.sites[number];
            if *values.is_joined[number].get_mut() || site.is_engine_site {
                continue;
            }
            *values.is_joined[number].get_mut() = true;
            for &(argument, _) in &site.args {
                if argument == u32::MAX {
                    continue;
                }
                let cell = &state[argument as usize];
                if cell.load(Ordering::Relaxed) & LEAKS != 0 {
                    continue;
                }
                values
                    .for_each_function_at(argument, |function| pending.push((function, argument)));
                cell.store(
                    cell.load(Ordering::Relaxed) & (HAS_SITES | HAS_ADDED_EDGES) | LEAKS,
                    Ordering::Relaxed,
                );
                values.more_functions[argument as usize % FunctionValues::SHARDS]
                    .get_mut()
                    .remove(&argument);
            }
        }
        if pending.is_empty() {
            break;
        }
    }
    let has_escaped: Vec<bool> = values
        .has_escaped
        .into_iter()
        .map(AtomicBool::into_inner)
        .collect();
    for function in (0..has_escaped.len())
        .filter(|&function| has_escaped[function])
        .map(FuncId::new)
    {
        let called = &program.funcs[function.idx()];
        if !called.has(func_flags::ASYNC | func_flags::GENERATOR) {
            more.edges
                .extend(unboxed_kinds(program, called.result).map(|kind| {
                    (
                        nodes.result(function.idx()),
                        nodes.produced + kind,
                        UNDEFINED,
                    )
                }));
        }
    }
    more
}

fn entrypoint_target(entry: &Func) -> Option<(FuncId, &[V])> {
    if !entry.has(func_flags::IS_GENERIC_ENTRYPOINT) {
        return None;
    }
    entry.values.iter().find_map(|value| match &value.def {
        Def::Op(Op::CallDirect { func: served, args }) => Some((*served, &args[..])),
        _ => None,
    })
}

fn holds_records_only(program: &Program, ty: TyId) -> bool {
    if ty.is_none() {
        return false;
    }
    let described = program.tys.get(ty);
    !described.any_object
        && !described.any_function
        && described.prims & !prim::NULLISH == 0
        && described.ints.is_none()
        && !described.parts.is_empty()
        && described
            .parts
            .iter()
            .all(|part| matches!(part, Part::Class(view) if view.is_some()))
}

fn is_rejected_by_every_layout(program: &Program, created: LayoutId, to: TyId) -> bool {
    let target = program.tys.get(to);
    let mut views = target
        .parts
        .iter()
        .filter_map(|part| {
            if let &Part::Class(view) = part {
                Some(view).filter(|view| view.is_some())
            } else {
                None
            }
        })
        .peekable();
    !target.any_object
        && views.peek().is_some()
        && views.all(|view| {
            view != created
                && !program.layouts[view.idx()].members.contains(&created)
                && !program.layouts[created.idx()]
                    .specializations
                    .contains(&view)
        })
}

pub(super) fn has_handlers(func: &Func) -> bool {
    func.blocks.iter().any(|block| {
        matches!(
            block.term,
            Some(
                Term::Invoke { .. }
                    | Term::Throw {
                        unwind: Some(_),
                        ..
                    }
            )
        )
    })
}

fn add_narrowing_facts(
    func: &Func,
    strs: &Strs,
    condition: V,
    sense: bool,
    depth: u32,
    shown: &mut Vec<(u32, u8)>,
) {
    if depth == 0 {
        return;
    }
    let key = |v: V| strip_casts(func, v).idx() as u32;
    match func.op(condition) {
        Some(&Op::Truthy(v)) => {
            if sense {
                shown.push((key(v), NULLISH));
            }
            add_narrowing_facts(func, strs, v, sense, depth - 1, shown);
        }
        Some(&Op::Not(v)) => add_narrowing_facts(func, strs, v, !sense, depth - 1, shown),
        Some(&Op::Coerce { value, why, .. }) if why != CoerceReason::Coerce => {
            add_narrowing_facts(func, strs, value, sense, depth - 1, shown)
        }
        Some(&Op::IsNullish(v)) => {
            if !sense {
                shown.push((key(v), NULLISH));
            }
        }
        Some(&Op::StrictEq { a, b }) => {
            for (it, other) in [(a, b), (b, a)] {
                match func.op(strip_casts(func, other)) {
                    Some(Op::Undefined) if !sense => shown.push((key(it), UNDEFINED)),
                    Some(Op::Null) if !sense => shown.push((key(it), NULL)),
                    Some(
                        Op::Bool(_) | Op::Int(_) | Op::Double(_) | Op::BigInt(_) | Op::Symbol(_),
                    ) if sense => shown.push((key(it), NULLISH)),
                    Some(&Op::Str(text)) => {
                        if sense {
                            shown.push((key(it), NULLISH));
                        }
                        if let Some(&Op::TypeOf(of)) = func.op(strip_casts(func, it)) {
                            match strs.get(text) {
                                b"undefined" if !sense => shown.push((key(of), UNDEFINED)),
                                b"undefined" => {}
                                b"object" if sense => shown.push((key(of), UNDEFINED)),
                                _ if sense => shown.push((key(of), NULLISH)),
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        Some(&Op::LooseEq { a, b }) => {
            for (it, other) in [(a, b), (b, a)] {
                if !sense
                    && matches!(
                        func.op(strip_casts(func, other)),
                        Some(Op::Undefined | Op::Null)
                    )
                {
                    shown.push((key(it), NULLISH));
                }
            }
        }
        Some(&Op::Relational { a, b, .. }) => {
            if sense {
                shown.push((key(a), UNDEFINED));
                shown.push((key(b), UNDEFINED));
            }
        }
        _ => {
            if sense {
                shown.push((key(condition), NULLISH));
            }
        }
    }
}

pub(super) fn fields_with_name(
    program: &Program,
    ty: TyId,
    name: StrId,
) -> SmallVec<[(LayoutId, u32); 2]> {
    if ty.is_none() {
        return SmallVec::new();
    }
    let layouts = program.tys.get(ty).parts.iter().filter_map(|part| {
        if let Part::Class(layout) = part {
            layout.is_some().then_some(*layout)
        } else {
            None
        }
    });
    layouts
        .filter_map(|layout| Some((layout, program.layouts[layout.idx()].field(name)?)))
        .collect()
}

fn deleted_property(func: &Func, op: &Op) -> Option<(V, StrId)> {
    match *op {
        Op::PropDelete { obj, name } => Some((obj, name)),
        Op::ElemDelete { obj, key } => match func.op(strip_casts(func, key)) {
            Some(&Op::Str(name)) => Some((obj, name)),
            _ => None,
        },
        _ => None,
    }
}

pub(super) type FieldsByName = Guarded<FxHashMap<StrId, Arc<[(LayoutId, u32)]>>>;

pub(super) fn fields_with_deleted_names(
    program: &Program,
    contents: &[u8],
    in_parallel: InParallel<'_>,
) -> FieldsByName {
    let mut runs: Vec<(&[Func], &[u8], Vec<StrId>)> = program
        .funcs
        .chunks(FUNCTIONS_PER_TASK)
        .zip(contents.chunks(FUNCTIONS_PER_TASK))
        .map(|(funcs, contents)| (funcs, contents, Vec::new()))
        .collect();
    for_each_mut(&mut runs, in_parallel, &|(funcs, contents, names)| {
        for (func, _) in funcs
            .iter()
            .zip(contents.iter())
            .filter(|function| function.1 & super::has::DELETIONS != 0)
        {
            names.extend(
                func.values
                    .iter()
                    .filter_map(|value| {
                        if let Def::Op(op) = &value.def {
                            deleted_property(func, op)
                        } else {
                            None
                        }
                    })
                    .map(|deleted| deleted.1),
            );
        }
    });
    let mut found: FxHashMap<StrId, Vec<(LayoutId, u32)>> = runs
        .into_iter()
        .flat_map(|run| run.2)
        .map(|name| (name, Vec::new()))
        .collect();
    if !found.is_empty() {
        for (index, layout) in program
            .layouts
            .iter()
            .enumerate()
            .filter(|of| of.1.kind != crate::ir::LayoutKind::Environment)
        {
            for (number, field) in layout.fields.iter().enumerate() {
                if let Some(having) = found.get_mut(&field.name)
                    && having.last().is_none_or(|last| last.0.idx() != index)
                {
                    having.push((LayoutId::new(index), number as u32));
                }
            }
        }
    }
    Guarded::new(
        found
            .into_iter()
            .map(|(name, having)| (name, having.into()))
            .collect(),
    )
}

fn fields_reachable_by_name(
    program: &Program,
    known: &FieldsByName,
    ty: TyId,
    name: StrId,
) -> Arc<[(LayoutId, u32)]> {
    let accepts_untyped_objects = |part: &Part| matches!(part, Part::Class(view) if view.is_some() && program.layouts[view.idx()].accepts_untyped);
    if ty.is_none()
        || ty == program.tys.anything
        || !program.tys.get(ty).any_object
            && !program
                .tys
                .get(ty)
                .parts
                .iter()
                .any(accepts_untyped_objects)
    {
        return Arc::default();
    }
    if let Some(found) = known.lock().get(&name) {
        return Arc::clone(found);
    }
    let of_objects = program
        .layouts
        .iter()
        .enumerate()
        .filter(|of| of.1.kind != crate::ir::LayoutKind::Environment);
    let found: Arc<[(LayoutId, u32)]> = of_objects
        .filter_map(|(index, layout)| Some((LayoutId::new(index), layout.field(name)?)))
        .collect();
    known.lock().insert(name, Arc::clone(&found));
    found
}

#[derive(Default)]
pub(super) struct Deleted {
    pub(super) places: usize,
    pub(super) slots_by_name: usize,
    pub(super) converted_by_name: usize,
    pub(super) never_observed_absent: usize,
    pub(super) turned: Vec<(LayoutId, StrId)>,
}

pub(super) fn widen_fields_for_deletions(
    program: &mut Program,
    contents: &[u8],
    fields_by_name: &FieldsByName,
    in_parallel: InParallel<'_>,
) -> Deleted {
    let mut deleted = Deleted::default();
    let (mut through, mut by_name): (Vec<(LayoutId, StrId)>, Vec<(LayoutId, StrId)>) =
        (Vec::new(), Vec::new());
    {
        let program: &Program = program;
        type Fields = Vec<(LayoutId, StrId)>;
        let mut runs: Vec<(&[Func], &[u8], Deleted, Fields, Fields)> = program
            .funcs
            .chunks(FUNCTIONS_PER_TASK)
            .zip(contents.chunks(FUNCTIONS_PER_TASK))
            .map(|(funcs, contents)| (funcs, contents, Deleted::default(), Vec::new(), Vec::new()))
            .collect();
        for_each_mut(&mut runs, in_parallel, &|(
            funcs,
            contents,
            deleted,
            through,
            by_name,
        )| {
            for (func, _) in funcs
                .iter()
                .zip(contents.iter())
                .filter(|function| function.1 & super::has::DELETIONS != 0)
            {
                for value in &func.values {
                    let Def::Op(op) = &value.def else { continue };
                    let Some((obj, name)) = deleted_property(func, op) else {
                        continue;
                    };
                    let (fields_by_layout, of_any_object) = (
                        fields_with_name(program, func.ty(obj), name),
                        fields_reachable_by_name(program, fields_by_name, func.ty(obj), name),
                    );
                    deleted.places += usize::from(!fields_by_layout.is_empty());
                    deleted.slots_by_name += usize::from(!of_any_object.is_empty());
                    through.extend(fields_by_layout.into_iter().map(|(view, _)| (view, name)));
                    by_name.extend(of_any_object.iter().map(|&(layout, _)| (layout, name)));
                }
            }
        });
        for (_, _, of_run, mut through_in_run, mut by_name_in_run) in runs {
            deleted.places += of_run.places;
            deleted.slots_by_name += of_run.slots_by_name;
            through.append(&mut through_in_run);
            by_name.append(&mut by_name_in_run);
        }
    }
    let through_supertypes = through.len();
    let mut seen: FxHashSet<(LayoutId, StrId)> = FxHashSet::default();
    for (number, (view, name)) in through.into_iter().chain(by_name).enumerate() {
        let mut pending = vec![view];
        while let Some(layout) = pending.pop() {
            if !seen.insert((layout, name)) {
                continue;
            }
            let own = &mut program.layouts[layout.idx()];
            pending.extend(own.members.iter().chain(&own.specializations).copied());
            let Some(field) = own.field(name) else {
                continue;
            };
            let flags = &mut own.fields[field as usize].flags;
            if *flags & (crate::ir::field_flags::OPTIONAL | crate::ir::field_flags::METHOD) == 0 {
                deleted.never_observed_absent +=
                    usize::from(*flags & crate::ir::field_flags::NEVER_OBSERVED_ABSENT != 0);
                *flags &= !crate::ir::field_flags::NEVER_OBSERVED_ABSENT;
                *flags |= crate::ir::field_flags::OPTIONAL;
                deleted.turned.push((layout, name));
                deleted.converted_by_name += usize::from(number >= through_supertypes);
            }
        }
    }
    deleted
}

pub(super) fn count_reads_of_deleted_fields(program: &Program, deleted: &Deleted) -> usize {
    let turned: FxHashSet<(LayoutId, StrId)> = deleted.turned.iter().copied().collect();
    let may_find = |view: LayoutId, name: StrId| {
        let looked_at = &program.layouts[view.idx()];
        looked_at
            .members
            .iter()
            .chain(&looked_at.specializations)
            .chain([&view])
            .any(|&member| turned.contains(&(member, name)))
    };
    let is_such = |func: &Func, def: &Def| matches!(*def, Def::Op(Op::PropGet { obj, name }) if fields_with_name(program, func.ty(obj), name).into_iter().any(|(view, _)| may_find(view, name)));
    if turned.is_empty() {
        0
    } else {
        program
            .funcs
            .iter()
            .map(|func| {
                func.values
                    .iter()
                    .filter(|value| is_such(func, &value.def))
                    .count()
            })
            .sum()
    }
}

fn method_resolved_in(program: &Program, layout: LayoutId, name: StrId) -> Option<FuncId> {
    let is_fact = |flags: u8| {
        flags & (single_function_flags::IS_PROVEN | single_function_flags::OR_NULLISH) != 0
    };
    let own: &Layout = &program.layouts[layout.idx()];
    if own.class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0 {
        return None;
    }
    let mut at = layout;
    while at.is_some() {
        let class = &program.layouts[at.idx()];
        if let Some(method) = class
            .methods
            .iter()
            .find(|method| method.name == name && method.flags & method_flags::STATIC == 0)
        {
            return (method.kind == MethodKind::Method
                && method.flags & method_flags::MAY_BE_REPLACED == 0)
                .then_some(method.func);
        }
        at = class.base;
    }
    let field = &own.fields[own.field(name)? as usize];
    (field.single_function.is_some() && is_fact(field.single_function_flags))
        .then_some(field.single_function)
}

pub(super) fn functions_called<'a>(
    program: &Program,
    func: &'a Func,
    v: V,
) -> Option<(SmallVec<[FuncId; 2]>, &'a [V])> {
    let is_fact = |flags: u8| {
        flags & (single_function_flags::IS_PROVEN | single_function_flags::OR_NULLISH) != 0
    };
    let found_by = |obj: V, name: StrId| -> Option<SmallVec<[FuncId; 2]>> {
        let ty = func.ty(obj);
        if ty.is_none() {
            return None;
        }
        let view = program.tys.get(ty).single_layout()?;
        let looked_at = &program.layouts[view.idx()];
        if looked_at.accepts_untyped {
            return None;
        }
        let mut found: SmallVec<[FuncId; 2]> = SmallVec::new();
        for &member in looked_at
            .members
            .iter()
            .chain(looked_at.members.is_empty().then_some(&view))
        {
            let function = method_resolved_in(program, member, name)?;
            if !found.contains(&function) {
                found.push(function);
            }
        }
        Some(found)
    };
    match func.op(v)? {
        Op::Call { callee, args, .. } => {
            let found = match *func.op(strip_casts(func, *callee))? {
                Op::FuncRef(function)
                | Op::Closure { func: function, .. }
                | Op::ClosureOnce { func: function, .. } => SmallVec::from_iter([function]),
                Op::FieldGet { layout, field, .. } => {
                    let field = &program.layouts[layout.idx()].fields[field as usize];
                    (field.single_function.is_some() && is_fact(field.single_function_flags))
                        .then(|| SmallVec::from_iter([field.single_function]))?
                }
                Op::GlobalGet(global) => {
                    let global = &program.globals[global.idx()];
                    (global.single_function.is_some() && is_fact(global.single_function_flags))
                        .then(|| SmallVec::from_iter([global.single_function]))?
                }
                Op::PropGet { obj, name } => found_by(obj, name)?,
                _ => return None,
            };
            Some((found, &args[..]))
        }
        Op::CallMethod { obj, name, args } => Some((found_by(*obj, *name)?, &args[..])),
        _ => None,
    }
}

fn is_definitely_field(
    program: &Program,
    known: &mut FxHashMap<(LayoutId, StrId), bool>,
    ty: TyId,
    name: StrId,
) -> bool {
    let Some(view) = (if ty.is_some() {
        program.tys.get(ty).single_layout()
    } else {
        None
    }) else {
        return false;
    };
    let looked_at = &program.layouts[view.idx()];
    let is_in_all = || {
        looked_at
            .members
            .iter()
            .chain(looked_at.members.is_empty().then_some(&view))
            .all(|member| program.layouts[member.idx()].field(name).is_some())
    };
    !looked_at.accepts_untyped
        && if looked_at.members.len() < MEMO_MIN_MEMBERS {
            is_in_all()
        } else {
            *known.entry((view, name)).or_insert_with(is_in_all)
        }
}

fn has_repeated_slot_name(
    program: &Program,
    func: &Func,
    definite_fields: &mut FxHashMap<(LayoutId, StrId), bool>,
) -> bool {
    let mut names: SmallVec<[StrId; 16]> = SmallVec::new();
    for &v in func.blocks.iter().flat_map(|block| &block.ops) {
        if let Some(&Op::PropGet { obj, name } | &Op::PropSet { obj, name, .. }) = func.op(v)
            && is_definitely_field(program, definite_fields, func.ty(obj), name)
        {
            if names.contains(&name) {
                return true;
            }
            names.push(name);
        }
    }
    false
}

fn slot_events(
    program: &Program,
    func: &Func,
    definite_fields: &mut FxHashMap<(LayoutId, StrId), bool>,
) -> (Vec<Vec<SlotEvent>>, Vec<u32>) {
    let key = |v: V| strip_casts(func, v).idx() as u32;
    let is_primitive = |v: V| {
        func.ty(v).is_some()
            && func.ty(v) != program.tys.anything
            && !program.tys.get(func.ty(v)).has_objects()
    };
    let mut stands_for: FxHashMap<V, V> = FxHashMap::default();
    loop {
        let object = |mut v: V| {
            loop {
                v = strip_casts(func, v);
                match stands_for.get(&v) {
                    Some(&same) => v = same,
                    None => return v,
                }
            }
        };
        let mut handed: FxHashMap<V, V> = FxHashMap::default();
        for block in &func.blocks {
            for target in targets_of(block.term.as_ref()) {
                for (&argument, &parameter) in target
                    .args
                    .iter()
                    .zip(&func.blocks[target.block.idx()].params)
                {
                    let argument = object(argument);
                    if argument != parameter && !stands_for.contains_key(&parameter) {
                        let known = handed.entry(parameter).or_insert(argument);
                        if *known != argument {
                            *known = V::NONE;
                        }
                    }
                }
            }
        }
        handed.retain(|_, same| same.is_some());
        if handed.is_empty() {
            break;
        }
        stands_for.extend(handed);
        let parameters: Vec<V> = stands_for.keys().copied().collect();
        let mut passed: Vec<V> = Vec::new();
        for parameter in parameters {
            let mut v = parameter;
            loop {
                v = strip_casts(func, v);
                match stands_for.get(&v) {
                    Some(&same) => {
                        passed.push(v);
                        v = same;
                    }
                    None => break,
                }
            }
            for link in passed.drain(..) {
                stands_for.insert(link, v);
            }
        }
    }
    let object = |mut v: V| {
        loop {
            v = strip_casts(func, v);
            match stands_for.get(&v) {
                Some(&same) => v = same,
                None => return v.idx() as u32,
            }
        }
    };
    let mut places: FxHashMap<(u32, StrId), u32> = FxHashMap::default();
    let mut names: Vec<u32> = Vec::new();
    let mut place = |obj: V, name: StrId| {
        *places.entry((object(obj), name)).or_insert_with(|| {
            names.push(name.idx() as u32);
            names.len() as u32 - 1
        })
    };
    let events = func
        .blocks
        .iter()
        .map(|block| {
            let mut events = Vec::new();
            for &v in &block.ops {
                match func.op(v) {
                    Some(&Op::PropGet { obj, name })
                        if is_definitely_field(program, definite_fields, func.ty(obj), name) =>
                    {
                        events.push(SlotEvent::Read {
                            place: place(obj, name),
                            value: key(v),
                        })
                    }
                    Some(&Op::PropSet { obj, name, value })
                        if is_definitely_field(program, definite_fields, func.ty(obj), name) =>
                    {
                        let may_be_nullish = func.ty(value).is_none()
                            || func.ty(value) == program.tys.anything
                            || program.tys.get(func.ty(value)).prims & prim::NULLISH != 0;
                        events.push(SlotEvent::Store {
                            place: place(obj, name),
                            value: key(value),
                            may_be_nullish,
                        });
                    }
                    Some(
                        Op::Undefined
                        | Op::Null
                        | Op::Bool(_)
                        | Op::Int(_)
                        | Op::Double(_)
                        | Op::Str(_)
                        | Op::BigInt(_)
                        | Op::Symbol(_)
                        | Op::FuncRef(_)
                        | Op::GlobalGet(_)
                        | Op::GlobalSet(..)
                        | Op::FieldGet { .. }
                        | Op::FieldSet { .. }
                        | Op::StrictEq { .. }
                        | Op::Not(_)
                        | Op::Truthy(_)
                        | Op::TypeOf(_)
                        | Op::IsNullish(_)
                        | Op::IsInstance { .. },
                    ) => {}
                    Some(&Op::Coerce { why, .. }) if why != CoerceReason::Coerce => {}
                    Some(&Op::Binary { a, b, .. } | &Op::Relational { a, b, .. })
                        if is_primitive(a) && is_primitive(b) => {}
                    Some(&Op::Unary { a, .. }) if is_primitive(a) => {}
                    _ => events.push(SlotEvent::Anything),
                }
            }
            events
        })
        .collect();
    (events, names)
}

struct Report<'a> {
    program: &'a Program,
    nodes: &'a Nodes,
    edges: Vec<(u32, u32)>,
    origins: Vec<(u32, u8)>,
    connected: FxHashSet<(LayoutId, u32)>,
    function_flows: FunctionValueFlows,
    methods_by_name: &'a FxHashMap<StrId, Vec<FuncId>>,
    static_methods_by_constructor: &'a FxHashMap<FuncId, Vec<(StrId, FuncId)>>,
    fields_by_name: &'a FieldsByName,
    definite_fields: FxHashMap<(LayoutId, StrId), bool>,
    functions_found: FxHashMap<(LayoutId, StrId), SmallVec<[FuncId; 1]>>,
}

impl Report<'_> {
    fn field(&mut self, layout: LayoutId, field: u32) -> u32 {
        self.connected.insert((layout, field));
        self.nodes.field(layout, field)
    }

    fn connect(&mut self, layout: LayoutId, field: u32) {
        let node = self.nodes.field(layout, field);
        {
            let own = &self.program.layouts[layout.idx()];
            let name = own.fields[field as usize].name;
            for &other in own
                .members
                .iter()
                .chain(&own.specializations)
                .filter(|&&other| other != layout)
            {
                if let Some(same) = self.program.layouts[other.idx()].field(name) {
                    let there = self.nodes.field(other, same);
                    self.edges.push((node, there));
                    self.edges.push((there, node));
                    let (layout_entry, of_member) = (
                        own.fields[field as usize].declared,
                        self.program.layouts[other.idx()].fields[same as usize].declared,
                    );
                    if layout_entry.is_some()
                        && of_member.is_some()
                        && layout_entry != self.program.tys.anything
                        && of_member != self.program.tys.anything
                    {
                        let missing = self.program.tys.get(of_member).prims
                            & prim::NULLISH
                            & !self.program.tys.get(layout_entry).prims;
                        if missing != 0 {
                            self.origins.push((node, missing as u8));
                        }
                    }
                }
            }
        }
    }

    fn pass_elements_to_callbacks(
        &mut self,
        func: &Func,
        handed: &[V],
        elements: &[usize],
        is_as_today: bool,
    ) {
        for &argument in handed {
            let (Some(&Op::FuncRef(function))
            | Some(&Op::Closure { func: function, .. })
            | Some(&Op::ClosureOnce { func: function, .. })) = func.op(strip_casts(func, argument))
            else {
                continue;
            };
            let called = &self.program.funcs[function.idx()];
            let Some(entered) = called.blocks.first() else {
                continue;
            };
            let ahead = entered.params.len().saturating_sub(called.params.len());
            for &parameter in elements
                .iter()
                .filter_map(|&number| entered.params.get(ahead + number))
            {
                if is_as_today {
                    self.origins
                        .push((self.nodes.value(function.idx(), parameter), UNDEFINED));
                    self.function_flows
                        .left_out
                        .push(self.nodes.value(function.idx(), parameter));
                } else {
                    self.function_flows
                        .handed
                        .push(self.nodes.value(function.idx(), parameter));
                }
            }
        }
    }

    fn function(&mut self, index: usize) -> FunctionNullishFlows {
        let (program, nodes) = (self.program, self.nodes);
        let func = &program.funcs[index];
        let mut flows = FunctionNullishFlows {
            blocks: func.blocks.len() as u32,
            ..FunctionNullishFlows::default()
        };
        let counts_tests = !has_handlers(func);
        let key = |v: V| strip_casts(func, v).idx() as u32;
        let node = |v: V| nodes.value(index, v);
        let parameter_of = |callee: FuncId, number: usize| -> Option<u32> {
            let entered = program.funcs[callee.idx()].blocks.first()?;
            Some(nodes.value(callee.idx(), *entered.params.get(number)?))
        };
        let returns_yielded_value = |callee: FuncId| {
            !program.funcs[callee.idx()].has(func_flags::ASYNC | func_flags::GENERATOR)
        };
        let fulfills_a_promise = |callee: FuncId| {
            program.funcs[callee.idx()].has(func_flags::ASYNC)
                && !program.funcs[callee.idx()].has(func_flags::GENERATOR)
        };
        let mut awaits_of: FxHashMap<V, SmallVec<[u32; 1]>> = FxHashMap::default();
        for &v in func.blocks.iter().flat_map(|block| &block.ops) {
            if let Some(&Op::Await(value)) = func.op(v) {
                awaits_of
                    .entry(strip_casts(func, value))
                    .or_default()
                    .push(node(v));
            }
        }
        if let Some((served, handed)) = entrypoint_target(func) {
            for (number, &argument) in handed.iter().enumerate() {
                if let Some(parameter) = parameter_of(served, number).filter(|_| argument.is_some())
                {
                    self.edges.push((parameter, node(argument)));
                }
            }
        }
        let claimed_by_entry = |callee: FuncId, number: usize| -> Option<TyId> {
            let entry = &program.funcs[callee.idx()];
            let handed = *entrypoint_target(entry)?.1.get(number)?;
            match entry.op(handed.is_some().then_some(handed)?) {
                Some(&Op::Coerce {
                    to,
                    why: CoerceReason::Claim,
                    ..
                }) => Some(to),
                _ => None,
            }
        };
        for (number, block) in func.blocks.iter().enumerate() {
            let condition = match block.term {
                Some(Term::Branch { cond, .. }) if counts_tests => cond,
                _ => V::NONE,
            };
            for (which, target) in targets_of(block.term.as_ref()).into_iter().enumerate() {
                let mut shown = Vec::new();
                if condition.is_some() {
                    add_narrowing_facts(func, &program.strs, condition, which == 0, 8, &mut shown);
                }
                flows.jumps.push(Jump {
                    from: number as u32,
                    to: target.block.idx() as u32,
                    shown,
                });
            }
        }
        let reaching_stores_for_reads =
            if counts_tests && has_repeated_slot_name(program, func, &mut self.definite_fields) {
                let (events, names) = slot_events(program, func, &mut self.definite_fields);
                reaching_stores_for_reads(&flows, &events, &names)
            } else {
                FxHashMap::default()
            };
        let mut local_arrays: FxHashSet<V> = func
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .copied()
            .filter(|&v| matches!(func.op(v), Some(Op::NewArray(_))))
            .collect();
        if !local_arrays.is_empty() {
            let mut has_other_uses = |operand: V| {
                if operand.is_some() {
                    local_arrays.remove(&strip_casts(func, operand));
                }
            };
            for block in &func.blocks {
                for &v in &block.ops {
                    match func.op(v) {
                        Some(Op::Coerce { .. } | Op::IterOpen(_)) | None => {}
                        Some(&Op::ElemGet { key, .. } | &Op::ElemHas { key, .. }) => {
                            has_other_uses(key)
                        }
                        Some(&Op::PropGet { name, .. }) if program.strs.get(name) == b"length" => {}
                        Some(op) => op.for_each_operand(&mut has_other_uses),
                    }
                }
                if let Some(term) = &block.term {
                    term.for_each_operand(&mut has_other_uses);
                }
            }
        }
        let mut jump = 0;
        for (number, block) in func.blocks.iter().enumerate() {
            let at = number as u32;
            for &v in &block.ops {
                let propagate = |flows: &mut FunctionNullishFlows, value: V, to: u32| {
                    if value.is_some() {
                        flows.uses.push(Use {
                            value: key(value),
                            from: node(value),
                            to,
                            block: at,
                            jump: NO_JUMP,
                        });
                    }
                };
                let seen = |value: V| value.is_some().then(|| node(value));
                let typed = |value: V| {
                    if value.is_some() {
                        (node(value), func.ty(value))
                    } else {
                        (u32::MAX, TyId::NONE)
                    }
                };
                match func.op(v) {
                    Some(&Op::ElemGet { obj: held, .. } | &Op::IterGet { iter: held, .. }) => {
                        let array = strip_casts(
                            func,
                            if let Some(&Op::IterOpen(opened)) = func.op(held) {
                                opened
                            } else {
                                held
                            },
                        );
                        if let Some(Op::NewArray(elements)) =
                            func.op(array).filter(|_| local_arrays.contains(&array))
                        {
                            self.function_flows.moves.extend(
                                elements
                                    .iter()
                                    .filter_map(|&element| seen(element))
                                    .map(|element| (element, node(v))),
                            );
                            self.function_flows.reads_from.extend(
                                elements
                                    .iter()
                                    .filter_map(|&element| seen(element))
                                    .map(|element| (element, node(v))),
                            );
                        }
                        self.function_flows.left_out.push(node(v));
                        flows.origins.push(Origin {
                            node: node(v),
                            nil: UNDEFINED,
                            block: at,
                            unless: Vec::new(),
                        });
                    }
                    Some(Op::NewArray(_)) if local_arrays.contains(&v) => {}
                    Some(Op::NewArray(elements)) => self
                        .function_flows
                        .leaks
                        .extend(elements.iter().filter_map(|&element| seen(element))),
                    Some(&Op::ElemSet { value, .. }) => {
                        self.function_flows.leaks.extend(seen(value))
                    }
                    Some(Op::IterOpen(_) | Op::IterClose(_) | Op::IterCloseForThrow(_)) => {}
                    Some(&Op::Coerce { value, to, why })
                        if why == CoerceReason::Forced
                            || matches!(
                                why,
                                CoerceReason::Flow
                                    | CoerceReason::Claim
                                    | CoerceReason::Store
                                    | CoerceReason::Cast
                                    | CoerceReason::CastFresh
                            ) && !func.has(func_flags::IS_HIDDEN_IN_STACK_TRACES)
                                && has_only_uninhabited_layouts(
                                    &program.tys,
                                    &program.layouts,
                                    to,
                                ) =>
                    {
                        propagate(&mut flows, value, node(v));
                        flows.origins.push(Origin {
                            node: node(v),
                            nil: UNTYPED_OBJECT,
                            block: at,
                            unless: Vec::new(),
                        });
                    }
                    Some(&Op::Coerce { value, to, why }) => {
                        if matches!(why, CoerceReason::NonNull(_) | CoerceReason::Coerce) {
                            self.function_flows.moves.push((node(value), node(v)));
                            if why == CoerceReason::Coerce
                                && to.is_some()
                                && let Some(
                                    &Op::New(created)
                                    | &Op::NewWith {
                                        layout: created, ..
                                    },
                                ) = func.op(strip_casts(func, value))
                                && is_rejected_by_every_layout(program, created, to)
                            {
                                flows.origins.push(Origin {
                                    node: node(v),
                                    nil: UNTYPED_OBJECT,
                                    block: at,
                                    unless: Vec::new(),
                                });
                                self.function_flows.stand_ins.push(node(v));
                            }
                            continue;
                        }
                        if let Some(stored) = reaching_stores_for_reads.get(&key(value)) {
                            for &stored in stored {
                                flows.uses.push(Use {
                                    value: stored,
                                    from: node(V::new(stored as usize)),
                                    to: node(v),
                                    block: at,
                                    jump: NO_JUMP,
                                });
                            }
                            continue;
                        }
                        propagate(&mut flows, value, node(v));
                        if matches!(
                            why,
                            CoerceReason::Store | CoerceReason::Cast | CoerceReason::CastFresh
                        ) && func.ty(value) != program.tys.anything
                            && func.ty(value).is_some()
                            && to.is_some()
                        {
                            let (have, want) =
                                (program.tys.get(func.ty(value)), program.tys.get(to));
                            let taken = have.prims & prim::NULLISH & !want.prims;
                            if taken != 0
                                && (Declared {
                                    prims: have.prims & !taken,
                                    ..have.clone()
                                })
                                .is_subset_of(want)
                            {
                                let unless = if counts_tests {
                                    vec![(key(value), taken as u8)]
                                } else {
                                    Vec::new()
                                };
                                flows.origins.push(Origin {
                                    node: node(v),
                                    nil: taken as u8,
                                    block: at,
                                    unless,
                                });
                            }
                        }
                    }
                    Some(&Op::Await(value)) => {
                        propagate(&mut flows, value, node(v));
                        if let Some(Op::CallDirect { func: callee, .. }) =
                            func.op(strip_casts(func, value))
                            && program.funcs[callee.idx()].has(func_flags::ASYNC)
                            && !program.funcs[callee.idx()].has(func_flags::GENERATOR)
                        {
                            self.edges.push((nodes.result(callee.idx()), node(v)));
                        }
                        self.function_flows.left_out.push(node(v));
                        flows.origins.push(Origin {
                            node: node(v),
                            nil: UNDEFINED,
                            block: at,
                            unless: Vec::new(),
                        });
                    }
                    Some(&Op::Yield(value)) => {
                        self.function_flows.leaks.extend(seen(value));
                        self.function_flows.left_out.push(node(v));
                        flows.origins.push(Origin {
                            node: node(v),
                            nil: UNDEFINED,
                            block: at,
                            unless: Vec::new(),
                        });
                    }
                    Some(&Op::GlobalGet(global)) => {
                        self.function_flows.allocation_sites.extend(
                            Some(program.globals[global.idx()].single_function)
                                .filter(|function| function.is_some())
                                .map(|function| (node(v), function)),
                        );
                        self.edges
                            .push((nodes.globals + global.idx() as u32, node(v)));
                    }
                    Some(&Op::GlobalSet(global, value)) => {
                        propagate(&mut flows, value, nodes.globals + global.idx() as u32)
                    }
                    Some(&Op::FieldGet { layout, field, .. }) => {
                        self.function_flows.allocation_sites.extend(
                            Some(
                                program.layouts[layout.idx()].fields[field as usize]
                                    .single_function,
                            )
                            .filter(|function| function.is_some())
                            .map(|function| (node(v), function)),
                        );
                        let from = self.field(layout, field);
                        self.edges.push((from, node(v)));
                    }
                    Some(&Op::FieldSet {
                        layout,
                        field,
                        value,
                        ..
                    }) => {
                        let to = self.field(layout, field);
                        propagate(&mut flows, value, to);
                    }
                    Some(&Op::NewWith {
                        layout,
                        name,
                        value,
                    }) => {
                        if let Some(field) = program.layouts[layout.idx()].field(name) {
                            let to = self.field(layout, field);
                            propagate(&mut flows, value, to);
                        } else {
                            self.function_flows.leaks.extend(seen(value));
                        }
                    }
                    Some(&Op::PropGet { obj, name }) => {
                        match program.strs.get(name) {
                            b"call" | b"apply" | b"bind" => {
                                self.function_flows.leaks.extend(seen(obj))
                            }
                            _ => {}
                        }
                        if holds_records_only(program, func.ty(obj)) {
                            self.function_flows.reads_from.push((node(obj), node(v)));
                        }
                        if let Some(view) = if func.ty(obj).is_some() {
                            program.tys.get(func.ty(obj)).single_layout()
                        } else {
                            None
                        } {
                            let looked_at = &program.layouts[view.idx()];
                            let found_in_members = || {
                                looked_at
                                    .members
                                    .iter()
                                    .chain(looked_at.members.is_empty().then_some(&view))
                                    .filter_map(move |&member| {
                                        method_resolved_in(program, member, name)
                                    })
                            };
                            if looked_at.members.len() < MEMO_MIN_MEMBERS {
                                self.function_flows
                                    .allocation_sites
                                    .extend(found_in_members().map(|function| (node(v), function)));
                            } else {
                                let found = self
                                    .functions_found
                                    .entry((view, name))
                                    .or_insert_with(|| found_in_members().collect());
                                self.function_flows
                                    .allocation_sites
                                    .extend(found.iter().map(|&function| (node(v), function)));
                            }
                        }
                        if let Some(&Op::FuncRef(class)) | Some(&Op::Closure { func: class, .. }) =
                            func.op(strip_casts(func, obj))
                        {
                            let statics = self
                                .static_methods_by_constructor
                                .get(&class)
                                .into_iter()
                                .flatten();
                            self.function_flows.allocation_sites.extend(
                                statics
                                    .filter(|method| method.0 == name)
                                    .map(|method| (node(v), method.1)),
                            );
                        }
                        let fields = fields_with_name(program, func.ty(obj), name);
                        if fields.is_empty()
                            && func.ty(obj).is_some()
                            && program.tys.get(func.ty(obj)).any_object
                        {
                            self.function_flows.left_out.push(node(v));
                            flows.origins.push(Origin {
                                node: node(v),
                                nil: UNDEFINED,
                                block: at,
                                unless: Vec::new(),
                            });
                        }
                        for (layout, field) in fields {
                            let from = self.field(layout, field);
                            self.edges.push((from, node(v)));
                        }
                    }
                    Some(&Op::PropSet { obj, name, value }) => {
                        if fields_with_name(program, func.ty(obj), name).is_empty() {
                            self.function_flows.leaks.extend(seen(value));
                        }
                        for (layout, field) in fields_with_name(program, func.ty(obj), name) {
                            let to = self.field(layout, field);
                            propagate(&mut flows, value, to);
                        }
                    }
                    Some(op @ (Op::PropDelete { .. } | Op::ElemDelete { .. })) => {
                        let Some((obj, name)) = deleted_property(func, op) else {
                            continue;
                        };
                        let of_any_object = fields_reachable_by_name(
                            program,
                            self.fields_by_name,
                            func.ty(obj),
                            name,
                        );
                        for (layout, field) in fields_with_name(program, func.ty(obj), name)
                            .into_iter()
                            .chain(of_any_object.iter().copied())
                        {
                            let emptied = self.field(layout, field);
                            self.origins.push((emptied, UNDEFINED));
                        }
                    }
                    Some(&Op::FuncRef(function)) => self
                        .function_flows
                        .allocation_sites
                        .push((node(v), function)),
                    Some(
                        Op::Closure {
                            func: created,
                            captures,
                        }
                        | Op::ClosureOnce {
                            func: created,
                            captures,
                            ..
                        },
                    ) => {
                        self.function_flows
                            .allocation_sites
                            .push((node(v), *created));
                        for (number, &capture) in captures.iter().enumerate() {
                            if let Some(to) = parameter_of(*created, number) {
                                propagate(&mut flows, capture, to);
                            } else {
                                self.function_flows.leaks.extend(seen(capture));
                            }
                        }
                    }
                    Some(Op::CallDirect { func: callee, args }) => {
                        for (number, &argument) in args.iter().enumerate() {
                            if let Some(to) = parameter_of(*callee, number) {
                                propagate(&mut flows, argument, to);
                                if argument.is_some()
                                    && func.ty(argument).is_some()
                                    && func.ty(argument) != program.tys.anything
                                    && let Some(claimed) = claimed_by_entry(*callee, number)
                                {
                                    let (have, want) = (
                                        program.tys.get(func.ty(argument)),
                                        program.tys.get(claimed),
                                    );
                                    let taken = have.prims & prim::NULLISH & !want.prims;
                                    if taken != 0
                                        && (Declared {
                                            prims: have.prims & !taken,
                                            ..have.clone()
                                        })
                                        .is_subset_of(want)
                                    {
                                        let unless = if counts_tests {
                                            vec![(key(argument), taken as u8)]
                                        } else {
                                            Vec::new()
                                        };
                                        flows.origins.push(Origin {
                                            node: to,
                                            nil: taken as u8,
                                            block: at,
                                            unless,
                                        });
                                    }
                                }
                            } else {
                                self.function_flows.leaks.extend(seen(argument));
                            }
                        }
                        if returns_yielded_value(*callee) {
                            self.edges.push((nodes.result(callee.idx()), node(v)));
                        }
                    }
                    Some(Op::Operation {
                        which: Operation::Initialize,
                        args,
                    }) => {
                        for store in args[1..].as_chunks::<2>().0 {
                            let Some(&Op::Str(name)) = func.op(store[0]) else {
                                self.function_flows.leaks.extend(seen(store[1]));
                                continue;
                            };
                            if fields_with_name(program, func.ty(args[0]), name).is_empty() {
                                self.function_flows.leaks.extend(seen(store[1]));
                            }
                            for (layout, field) in fields_with_name(program, func.ty(args[0]), name)
                            {
                                let to = self.field(layout, field);
                                propagate(&mut flows, store[1], to);
                            }
                        }
                    }
                    Some(Op::Call { .. } | Op::CallMethod { .. }) => {
                        let Some((callees, args)) = functions_called(program, func, v) else {
                            let mut is_engine_site = false;
                            let by_name = match func.op(v) {
                                Some(&Op::CallMethod {
                                    obj,
                                    name,
                                    ref args,
                                }) => Some((obj, name, &args[..])),
                                Some(&Op::Call {
                                    callee,
                                    this,
                                    ref args,
                                }) => match func.op(strip_casts(func, callee)) {
                                    Some(&Op::PropGet { obj, name })
                                        if this.is_some()
                                            && strip_casts(func, obj)
                                                == strip_casts(func, this) =>
                                    {
                                        Some((obj, name, &args[..]))
                                    }
                                    _ => None,
                                },
                                _ => None,
                            };
                            if let Some((obj, name, handed)) = by_name {
                                if may_reach_program_code(program, func, v) {
                                    for &method in
                                        self.methods_by_name.get(&name).into_iter().flatten()
                                    {
                                        let called = &program.funcs[method.idx()];
                                        let Some(entered) = called.blocks.first() else {
                                            continue;
                                        };
                                        let ahead = entered
                                            .params
                                            .len()
                                            .saturating_sub(called.params.len());
                                        for &parameter in
                                            entered.params.iter().skip(ahead + handed.len())
                                        {
                                            self.origins.push((
                                                nodes.value(method.idx(), parameter),
                                                UNDEFINED,
                                            ));
                                        }
                                    }
                                }
                                let receiver = func.ty(obj);
                                let is_array = receiver.is_some()
                                    && !program.tys.get(receiver).any_object
                                    && program
                                        .tys
                                        .get(receiver)
                                        .parts
                                        .iter()
                                        .all(|part| matches!(part, Part::Array(_)));
                                self.pass_elements_to_callbacks(
                                    func,
                                    handed,
                                    callback_element_parameters(program.strs.get(name), is_array),
                                    matches!(func.op(v), Some(Op::CallMethod { .. })),
                                );
                                is_engine_site =
                                    !callback_element_parameters(program.strs.get(name), is_array)
                                        .is_empty()
                                        && !may_reach_program_code(program, func, v);
                            }
                            let (callees, handed): (SmallVec<[u32; 1]>, &[V]) = match func.op(v) {
                                Some(&Op::Call {
                                    callee,
                                    this,
                                    ref args,
                                }) => {
                                    self.function_flows.leaks.extend(seen(this));
                                    (SmallVec::from_iter([node(callee)]), &args[..])
                                }
                                Some(&Op::CallMethod {
                                    obj,
                                    name,
                                    ref args,
                                }) => {
                                    if matches!(
                                        program.strs.get(name),
                                        b"call" | b"apply" | b"bind"
                                    ) {
                                        self.function_flows.leaks.extend(seen(obj));
                                    }
                                    (
                                        fields_with_name(program, func.ty(obj), name)
                                            .into_iter()
                                            .map(|(layout, field)| self.field(layout, field))
                                            .collect(),
                                        &args[..],
                                    )
                                }
                                _ => continue,
                            };
                            if !is_engine_site && !may_reach_program_code(program, func, v) {
                                self.function_flows
                                    .leaks
                                    .extend(handed.iter().filter_map(|&argument| seen(argument)));
                            }
                            let is_engine_site =
                                is_engine_site || !may_reach_program_code(program, func, v);
                            self.function_flows.sites.push(Site {
                                callees,
                                args: handed.iter().map(|&argument| typed(argument)).collect(),
                                result: Some(node(v)),
                                is_engine_site,
                            });
                            if may_reach_program_code(program, func, v) {
                                self.edges.extend(
                                    unboxed_kinds(program, func.ty(v))
                                        .map(|kind| (nodes.produced + kind, node(v))),
                                );
                            }
                            continue;
                        };
                        for callee in callees {
                            let called = &program.funcs[callee.idx()];
                            let ahead = called
                                .blocks
                                .first()
                                .map_or(0, |entered| entered.params.len())
                                .saturating_sub(called.params.len());
                            self.function_flows.leaks.extend(
                                args.iter()
                                    .skip(called.params.len())
                                    .filter_map(|&argument| seen(argument)),
                            );
                            for (number, &argument) in
                                args.iter().enumerate().take(called.params.len())
                            {
                                if let Some(to) = parameter_of(callee, ahead + number) {
                                    propagate(&mut flows, argument, to);
                                } else {
                                    self.function_flows.leaks.extend(seen(argument));
                                }
                            }
                            for &parameter in
                                called.blocks.first().into_iter().flat_map(|entered| {
                                    entered.params.iter().skip(ahead + args.len())
                                })
                            {
                                self.origins
                                    .push((nodes.value(callee.idx(), parameter), UNDEFINED));
                            }
                            if returns_yielded_value(callee) {
                                self.edges.push((nodes.result(callee.idx()), node(v)));
                            } else if fulfills_a_promise(callee) {
                                self.edges.extend(
                                    awaits_of
                                        .get(&v)
                                        .into_iter()
                                        .flatten()
                                        .map(|&awaited| (nodes.result(callee.idx()), awaited)),
                                );
                            }
                        }
                    }
                    Some(Op::Operation {
                        which: Operation::ConstructWith,
                        args,
                    }) if args.len() >= 2 => {
                        self.function_flows.sites.push(Site {
                            callees: SmallVec::from_iter([node(args[0])]),
                            args: args[2..].iter().map(|&argument| typed(argument)).collect(),
                            result: None,
                            is_engine_site: false,
                        });
                    }
                    Some(Op::Operation {
                        which: Operation::SuperConstruct,
                        args,
                    }) => {
                        self.function_flows
                            .leaks
                            .extend(args.get(3).and_then(|&parent| seen(parent)));
                    }
                    Some(Op::Operation {
                        which:
                            Operation::MakeClass
                            | Operation::SetFunctionName
                            | Operation::IsCallable
                            | Operation::IsConstructor,
                        ..
                    }) => {}
                    Some(Op::Construct { callee, args }) => {
                        self.function_flows.sites.push(Site {
                            callees: SmallVec::from_iter([node(*callee)]),
                            args: args.iter().map(|&argument| typed(argument)).collect(),
                            result: None,
                            is_engine_site: matches!(
                                func.op(strip_casts(func, *callee)),
                                Some(Op::FreeGet { .. })
                            ),
                        });
                    }
                    Some(
                        Op::StrictEq { .. }
                        | Op::LooseEq { .. }
                        | Op::Not(_)
                        | Op::Truthy(_)
                        | Op::TypeOf(_)
                        | Op::IsNullish(_)
                        | Op::IsInstance { .. }
                        | Op::InstanceOf { .. }
                        | Op::Relational { .. }
                        | Op::Binary { .. }
                        | Op::Unary { .. }
                        | Op::ToStr(_)
                        | Op::ToKey(_)
                        | Op::StrConcat(_)
                        | Op::PropHas { .. }
                        | Op::ElemHas { .. }
                        | Op::IterHas { .. },
                    ) => {}
                    Some(op) => op.for_each_operand(|operand| {
                        self.function_flows.leaks.extend(seen(operand))
                    }),
                    None => {}
                }
            }
            match block.term.as_ref() {
                Some(&Term::Return(value))
                    if value.is_some() && func.has(func_flags::ASYNC | func_flags::GENERATOR) =>
                {
                    self.function_flows.leaks.push(node(value))
                }
                Some(&Term::Throw { value, .. }) if value.is_some() => {
                    self.function_flows.leaks.push(node(value))
                }
                _ => {}
            }
            if let Some(&Term::Return(value)) = block.term.as_ref()
                && value.is_some()
                && !func.has(func_flags::GENERATOR)
            {
                flows.uses.push(Use {
                    value: key(value),
                    from: node(value),
                    to: nodes.result(index),
                    block: at,
                    jump: NO_JUMP,
                });
            }
            for target in targets_of(block.term.as_ref()) {
                for (&argument, &parameter) in target
                    .args
                    .iter()
                    .zip(&func.blocks[target.block.idx()].params)
                {
                    flows.uses.push(Use {
                        value: key(argument),
                        from: node(argument),
                        to: node(parameter),
                        block: at,
                        jump,
                    });
                }
                jump += 1;
            }
        }
        flows
    }
}

pub(super) struct Overlay<'a> {
    known: &'a DeclaredTable,
    added: Vec<Declared>,
    ids: FxHashMap<Declared, TyId>,
    pub(super) anything: TyId,
}

impl Overlay<'_> {
    fn new(known: &DeclaredTable) -> Overlay<'_> {
        Overlay {
            known,
            added: Vec::new(),
            ids: FxHashMap::default(),
            anything: known.anything,
        }
    }
    pub(super) fn known(&self) -> &DeclaredTable {
        self.known
    }
    pub(super) fn get(&self, id: TyId) -> &Declared {
        match id.idx().checked_sub(self.known.list.len()) {
            None => self.known.get(id),
            Some(index) => &self.added[index],
        }
    }
    pub(super) fn intern(&mut self, declared: Declared) -> TyId {
        if let Some(id) = self
            .known
            .find(&declared)
            .or_else(|| self.ids.get(&declared).copied())
        {
            return id;
        }
        let id = TyId::new(self.known.list.len() + self.added.len());
        self.added.push(declared.clone());
        self.ids.insert(declared, id);
        id
    }
}

pub(super) struct Slice<'a> {
    first: usize,
    pub(super) funcs: &'a mut [Func],
    has_wider_values: &'a mut [bool],
    pub(super) tys: Overlay<'a>,
}

pub(super) fn for_each_slice(
    tys: &mut DeclaredTable,
    funcs: &mut [Func],
    has_wider_values: &mut [bool],
    in_parallel: InParallel<'_>,
    work: &(dyn Fn(&mut Slice<'_>) + Sync),
) {
    let known = tys.list.len();
    let added: Vec<Vec<Declared>> = {
        let tys: &DeclaredTable = tys;
        let mut slices: Vec<Slice<'_>> = (funcs
            .chunks_mut(FUNCTIONS_PER_TASK)
            .zip(has_wider_values.chunks_mut(FUNCTIONS_PER_TASK))
            .enumerate())
        .map(|(number, (funcs, has_wider_values))| Slice {
            first: number * FUNCTIONS_PER_TASK,
            funcs,
            has_wider_values,
            tys: Overlay::new(tys),
        })
        .collect();
        for_each_mut(&mut slices, in_parallel, &|slice| work(slice));
        slices.into_iter().map(|slice| slice.tys.added).collect()
    };
    let renamed: Vec<Vec<TyId>> = added
        .into_iter()
        .map(|added| {
            added
                .into_iter()
                .map(|declared| tys.intern(declared))
                .collect()
        })
        .collect();
    let mut slices: Vec<(&mut [Func], &Vec<TyId>)> = funcs
        .chunks_mut(FUNCTIONS_PER_TASK)
        .zip(&renamed)
        .filter(|slice| !slice.1.is_empty())
        .collect();
    for_each_mut(&mut slices, in_parallel, &|(funcs, renamed)| {
        let rename = |ty: &mut TyId| {
            if ty.is_some() && ty.idx() >= known {
                *ty = renamed[ty.idx() - known];
            }
        };
        for func in funcs.iter_mut() {
            for value in &mut func.values {
                rename(&mut value.ty);
                if let Def::Op(Op::Coerce { to, .. }) = &mut value.def {
                    rename(to);
                }
            }
            rename(&mut func.result);
            rename(&mut func.declared_this_type);
            func.captures
                .iter_mut()
                .chain(&mut func.params)
                .for_each(rename);
        }
    });
}

fn integer_range_from_operands(func: &Func, tys: &Overlay<'_>, value: V) -> Option<(i64, i64)> {
    const MAX_MAGNITUDE: i64 = 1 << 52;
    let range_of = |operand: V| {
        let ty = func.ty(operand);
        if ty.is_none() || ty == tys.anything {
            return None;
        }
        let described = tys.get(ty);
        let is_integer_only = described.prims == 0
            && described.parts.is_empty()
            && !described.any_object
            && !described.any_function;
        described.ints.filter(|_| is_integer_only)
    };
    let (minimum, maximum) = match *func.op(value)? {
        Op::Unary {
            op: UnOp::ToNumber | UnOp::ToNumeric,
            a,
        } => range_of(a)?,
        Op::Binary {
            op: BinOp::Add,
            a,
            b,
        } => {
            let (a, b) = (range_of(a)?, range_of(b)?);
            (a.0.checked_add(b.0)?, a.1.checked_add(b.1)?)
        }
        Op::Binary {
            op: BinOp::Sub,
            a,
            b,
        } => {
            let (a, b) = (range_of(a)?, range_of(b)?);
            (a.0.checked_sub(b.1)?, a.1.checked_sub(b.0)?)
        }
        _ => return None,
    };
    (minimum >= -MAX_MAGNITUDE && maximum <= MAX_MAGNITUDE).then_some((minimum, maximum))
}

pub(super) fn narrow_integer_arithmetic(program: &mut Program, in_parallel: InParallel<'_>) {
    let Program {
        tys: table, funcs, ..
    } = program;
    let number = table.intern(Declared::prims(prim::NUMBER));
    let mut unused = vec![false; funcs.len()];
    for_each_slice(
        table,
        funcs,
        &mut unused,
        in_parallel,
        &|Slice { funcs, tys, .. }| {
            for func in funcs.iter_mut() {
                loop {
                    let mut has_changed = false;
                    for block in 0..func.blocks.len() {
                        for at in 0..func.blocks[block].ops.len() {
                            let value = func.blocks[block].ops[at];
                            if func.ty(value) != number {
                                continue;
                            }
                            if let Some((minimum, maximum)) =
                                integer_range_from_operands(func, tys, value)
                            {
                                func.values[value.idx()].ty =
                                    tys.intern(Declared::ints(minimum, maximum));
                                has_changed = true;
                            }
                        }
                    }
                    if !has_changed {
                        break;
                    }
                }
            }
        },
    );
}

fn with_nullish(tys: &mut Overlay<'_>, ty: TyId, nil: u8) -> TyId {
    if nil == 0 || ty.is_none() || ty == tys.anything {
        return ty;
    }
    if nil & UNTYPED_OBJECT != 0 {
        return tys.anything;
    }
    let described = tys.get(ty);
    if described.is_never() || nil as u32 & !described.prims == 0 {
        return ty;
    }
    let wider = Declared {
        prims: described.prims | nil as u32,
        ..described.clone()
    };
    tys.intern(wider)
}

fn excess_nullish(tys: &Overlay<'_>, have: TyId, want: TyId) -> u32 {
    if have.is_none() || want.is_none() || have == want || want == tys.anything {
        return 0;
    }
    tys.get(have).prims & prim::NULLISH & !tys.get(want).prims
}

fn narrowed(
    func: &mut Func,
    tys: &mut Overlay<'_>,
    ops: &mut Vec<V>,
    created: &mut FxHashMap<(V, TyId), V>,
    value: V,
    want: TyId,
) -> V {
    if value.is_none() {
        return value;
    }
    let have = func.ty(value);
    if have == tys.anything {
        return value;
    }
    let too_much = excess_nullish(tys, have, want);
    if too_much == 0 {
        return value;
    }
    let described = tys.get(have);
    let to = Declared {
        prims: described.prims & !too_much,
        ..described.clone()
    };
    let to = tys.intern(to);
    *created.entry((value, to)).or_insert_with(|| {
        let pos = func.values[value.idx()].pos;
        let held = func.add_value(
            Op::Coerce {
                value,
                to,
                why: CoerceReason::Flow,
            },
            pos,
            to,
        );
        ops.push(held);
        held
    })
}

fn as_boolean(func: &mut Func, tys: &Overlay<'_>, ops: &mut Vec<V>, boolean: TyId, value: V) -> V {
    if excess_nullish(tys, func.ty(value), boolean) == 0 {
        return value;
    }
    let pos = func.values[value.idx()].pos;
    let tested = func.add_value(Op::Truthy(value), pos, boolean);
    ops.push(tested);
    tested
}

pub(super) fn is_uninhabited_layout(layout: &Layout) -> bool {
    layout.members.is_empty() && !layout.accepts_untyped && !layout.is_allocated
}

fn has_only_uninhabited_layouts(tys: &DeclaredTable, layouts: &[Layout], ty: TyId) -> bool {
    if ty.is_none() || ty == tys.anything {
        return false;
    }
    let described = tys.get(ty);
    !described.parts.is_empty()
        && !described.any_object
        && !described.any_function
        && described.prims & !prim::NULLISH == 0
        && described.ints.is_none()
        && described.parts.iter().all(|part| matches!(part, Part::Class(view) if view.is_some() && is_uninhabited_layout(&layouts[view.idx()])))
}

const FUNCTIONS_PER_TASK: usize = 256;
const NODES_PER_RUN: usize = 1 << 14;

pub(super) fn widen_for_nullish(
    program: &mut Program,
    contents: &[u8],
    fields_by_name: &FieldsByName,
    in_parallel: InParallel<'_>,
    while_waiting: &mut (dyn FnMut(&Program) + Send),
) {
    let nodes = Nodes::new(program);
    let reaching = {
        let program: &Program = program;
        let mut methods_by_name: FxHashMap<StrId, Vec<FuncId>> = FxHashMap::default();
        for method in program.layouts.iter().flat_map(|layout| &layout.methods) {
            if method.name.is_some()
                && method.kind == MethodKind::Method
                && method.flags & method_flags::STATIC == 0
            {
                methods_by_name
                    .entry(method.name)
                    .or_default()
                    .push(method.func);
            }
        }
        let methods_by_name = &methods_by_name;
        let mut static_methods_by_constructor: FxHashMap<FuncId, Vec<(StrId, FuncId)>> =
            FxHashMap::default();
        for layout in &program.layouts {
            for method in layout
                .methods
                .iter()
                .filter(|method| method.flags & method_flags::STATIC != 0)
            {
                static_methods_by_constructor
                    .entry(layout.constructor)
                    .or_default()
                    .push((method.name, method.func));
            }
        }
        let static_methods_by_constructor = &static_methods_by_constructor;
        let report = || Report {
            program,
            nodes: &nodes,
            edges: Vec::new(),
            origins: Vec::new(),
            connected: FxHashSet::default(),
            function_flows: FunctionValueFlows::default(),
            methods_by_name,
            static_methods_by_constructor,
            fields_by_name,
            definite_fields: FxHashMap::default(),
            functions_found: FxHashMap::default(),
        };
        let mut slices: Vec<(usize, Report<'_>, NullishEdges)> = (0..program.funcs.len())
            .step_by(FUNCTIONS_PER_TASK)
            .map(|first| (first, report(), NullishEdges::default()))
            .collect();
        let mut state = vec![0u32; nodes.count as usize];
        let mut state_left = &mut state[..nodes.results as usize];
        let ends: Vec<u32> = slices
            .iter()
            .skip(1)
            .map(|slice| nodes.values[slice.0])
            .chain([nodes.results])
            .collect();
        let mut tasks: Vec<(&mut (usize, Report<'_>, NullishEdges), &mut [u32])> =
            Vec::with_capacity(slices.len());
        for (slice, end) in slices.iter_mut().zip(ends) {
            let of_slice;
            (of_slice, state_left) = std::mem::take(&mut state_left)
                .split_at_mut((end - nodes.values[slice.0]) as usize);
            tasks.push((slice, of_slice));
        }
        for_each_mut(&mut tasks, in_parallel, &|(
            (first, report, found),
            state,
        )| {
            let mut room = FlowScratch::default();
            for index in (*first..program.funcs.len()).take(FUNCTIONS_PER_TASK) {
                let flows = report.function(index);
                add_function_nullish_flows(&flows, found, &mut room);
            }
            for node in std::mem::take(&mut report.function_flows.leaks) {
                state[(node - nodes.values[*first]) as usize] |= node_state::LEAKS;
            }
            found.edges.extend(
                report
                    .edges
                    .drain(..)
                    .map(|(from, to)| (from, to, NULLISH | UNTYPED_OBJECT)),
            );
            found.edges.extend(
                report
                    .function_flows
                    .moves
                    .drain(..)
                    .map(|(from, to)| (from, to, 0)),
            );
            found.origins.append(&mut report.origins);
        });
        const FIELDS_PER_TASK: usize = 256;
        let mut connected: Vec<(LayoutId, u32)> = slices
            .iter()
            .flat_map(|slice| slice.1.connected.iter().copied())
            .collect();
        connected.sort_unstable_by_key(|&(layout, field)| (layout.idx(), field));
        connected.dedup();
        let mut connecting: Vec<(&[(LayoutId, u32)], Report<'_>)> = connected
            .chunks(FIELDS_PER_TASK)
            .map(|fields| (fields, report()))
            .collect();
        for_each_mut(&mut connecting, in_parallel, &|(fields, report)| {
            for &(layout, field) in fields.iter() {
                report.connect(layout, field);
            }
        });
        let mut between_fields = NullishEdges::default();
        for (_, report) in connecting {
            between_fields.edges.extend(
                report
                    .edges
                    .into_iter()
                    .map(|(from, to)| (from, to, NULLISH | UNTYPED_OBJECT)),
            );
            between_fields.origins.extend(report.origins);
        }
        let mut found: Vec<FunctionValueFlows> = slices
            .iter_mut()
            .map(|slice| std::mem::take(&mut slice.1.function_flows))
            .collect();
        let (mut left_out, mut reads_from, mut stand_ins, mut handed): (
            Vec<Vec<u32>>,
            Vec<Vec<(u32, u32)>>,
            Vec<Vec<u32>>,
            Vec<Vec<u32>>,
        ) = Default::default();
        for part in &mut found {
            left_out.push(std::mem::take(&mut part.left_out));
            reads_from.push(std::mem::take(&mut part.reads_from));
            stand_ins.push(std::mem::take(&mut part.stand_ins));
            handed.push(std::mem::take(&mut part.handed));
        }
        let runs: Vec<u32> = slices
            .iter()
            .map(|slice| nodes.values[slice.0])
            .chain((nodes.results..nodes.count).step_by(NODES_PER_RUN))
            .collect();
        let parts: Vec<&[(u32, u32, u8)]> = slices
            .iter()
            .map(|slice| &slice.2)
            .chain([&between_fields])
            .map(|part| &part.edges[..])
            .collect();
        let leaving: OnceLock<EdgesByNode> = OnceLock::new();
        let (are_made, awaited) = std::sync::mpsc::channel::<()>();
        let (
            mut entered,
            mut reaching,
            flows_into_field,
            reads_from,
            stand_ins,
            handed,
            from_containers,
        ) = std::thread::scope(|scope| {
            let (program, of_nodes, created) = (&*program, &nodes, &leaving);
            let entered = scope.spawn(move || {
                let leaving = || {
                    awaited
                        .recv()
                        .expect("the thread that makes the edges panicked");
                    created
                        .get()
                        .expect("the edges are made before that is said")
                };
                propagate_function_values(program, of_nodes, leaving, &found, state)
            });
            let beside = scope.spawn(move || while_waiting(program));
            let leaving = leaving.get_or_init(|| {
                edges_by_node(
                    nodes.count,
                    &runs,
                    &parts,
                    |edge| Some((edge.0, edge.1)),
                    in_parallel,
                )
            });
            are_made
                .send(())
                .expect("the thread that follows the functions is there");
            let (runs, parts) = (&runs, &parts);
            let entering = scope.spawn(move || {
                edges_by_node(
                    of_nodes.count,
                    runs,
                    parts,
                    |edge| {
                        (edge.2 & UNDEFINED != 0 && edge.0 < of_nodes.produced)
                            .then_some((edge.1, edge.0))
                    },
                    in_parallel,
                )
            });
            let reported_origins: Vec<&[(u32, u8)]> =
                slices.iter().map(|slice| &slice.2.origins[..]).collect();
            let flattened = scope.spawn(move || {
                let mut is_left_out = vec![false; of_nodes.count as usize];
                for node in left_out.into_iter().flatten() {
                    is_left_out[node as usize] = true;
                }
                let reads_from: Vec<(u32, u32, u8)> = reads_from
                    .into_iter()
                    .flatten()
                    .map(|(from, to)| (from, to, UNTYPED_OBJECT))
                    .collect();
                let stand_ins: Vec<(u32, u8)> = stand_ins
                    .into_iter()
                    .flatten()
                    .map(|node| (node, UNTYPED_OBJECT))
                    .collect();
                let handed: Vec<u32> = handed.into_iter().flatten().collect();
                let from_containers = NullishEdges {
                    edges: Vec::new(),
                    origins: reported_origins
                        .into_iter()
                        .flatten()
                        .filter(|origin| is_left_out[origin.0 as usize])
                        .map(|origin| (origin.0, origin.1 & UNDEFINED))
                        .collect(),
                };
                (reads_from, stand_ins, handed, from_containers)
            });
            let reaching = propagate_nullish(
                leaving,
                &[],
                slices
                    .iter()
                    .map(|slice| &slice.2)
                    .chain([&between_fields])
                    .flat_map(|part| part.origins.iter().copied()),
                |_, _| false,
                in_parallel,
            );
            let mut flows_into_field = vec![false; nodes.count as usize];
            {
                let mut pending: Vec<u32> = Vec::new();
                for (index, layout) in program
                    .layouts
                    .iter()
                    .enumerate()
                    .filter(|it| it.1.kind != LayoutKind::Environment)
                {
                    for (number, field) in layout.fields.iter().enumerate() {
                        let node = nodes.field(LayoutId::new(index), number as u32);
                        if reaching[node as usize] & UNDEFINED == 0
                            && field.declared.is_some()
                            && field.declared != program.tys.anything
                            && program.tys.get(field.declared).prims & prim::UNDEFINED == 0
                        {
                            flows_into_field[node as usize] = true;
                            pending.push(node);
                        }
                    }
                }
                let entering = entering
                    .join()
                    .expect("the thread that makes the entering edges panicked");
                flows_into_field =
                    reach_backward(&entering, flows_into_field, &pending, in_parallel);
            }
            beside
                .join()
                .expect("the thread that works beside the nullish flows panicked");
            let (reads_from, stand_ins, handed, from_containers) = flattened
                .join()
                .expect("the thread that flattens the reported lists panicked");
            (
                entered
                    .join()
                    .expect("the thread that follows the functions panicked"),
                reaching,
                flows_into_field,
                reads_from,
                stand_ins,
                handed,
                from_containers,
            )
        });
        let leaving = leaving.get().expect("the edges were made above");
        entered
            .origins
            .extend(handed.into_iter().map(|node| (node, UNDEFINED)));
        entered
            .edges
            .retain(|edge| !flows_into_field[edge.1 as usize]);
        entered
            .origins
            .retain(|origin| !flows_into_field[origin.0 as usize]);
        if !stand_ins.is_empty() {
            entered.edges.extend(reads_from);
        }
        let further = propagate_nullish(
            leaving,
            &entered.edges,
            entered
                .origins
                .iter()
                .chain(&from_containers.origins)
                .chain(&stand_ins)
                .copied(),
            |from, to| from >= nodes.produced && flows_into_field[to as usize],
            in_parallel,
        );
        for (all, more) in reaching.iter_mut().zip(further) {
            *all |= more;
        }
        reaching
    };
    let Program {
        tys: table,
        funcs,
        layouts,
        globals,
        ..
    } = program;
    let mut over = Overlay::new(table);
    let tys = &mut over;
    for (index, layout) in layouts.iter_mut().enumerate() {
        for (number, field) in layout.fields.iter_mut().enumerate() {
            field.declared = with_nullish(
                tys,
                field.declared,
                reaching[nodes.field(LayoutId::new(index), number as u32) as usize],
            );
        }
    }
    for (index, global) in globals.iter_mut().enumerate() {
        global.declared = with_nullish(
            tys,
            global.declared,
            reaching[nodes.globals as usize + index],
        );
    }
    for declared in over.added {
        table.intern(declared);
    }
    let (layouts, globals): (&[Layout], &[crate::ir::Global]) = (layouts, globals);
    let mut has_wider_values = vec![false; funcs.len()];
    for_each_slice(
        table,
        funcs,
        &mut has_wider_values,
        in_parallel,
        &|Slice {
              first,
              funcs,
              has_wider_values,
              tys,
          }| {
            for (offset, func) in funcs.iter_mut().enumerate() {
                let index = *first + offset;
                let mut is_widened = vec![false; func.values.len()];
                for number in 0..func.values.len() {
                    let nil = reaching[nodes.value(index, V::new(number)) as usize];
                    if nil == 0 {
                        continue;
                    }
                    has_wider_values[offset] = true;
                    let value = &mut func.values[number];
                    is_widened[number] = value.ty.is_some()
                        && value.ty != tys.anything
                        && tys.get(value.ty).prims & prim::NULLISH == 0;
                    let is_empty = |view: &Part| matches!(view, Part::Class(view) if view.is_some() && is_uninhabited_layout(&layouts[view.idx()]));
                    if nil & UNTYPED_OBJECT != 0
                        && value.ty.is_some()
                        && value.ty != tys.anything
                        && value.prediction() == Prediction::None
                        && !tys.get(value.ty).parts.iter().any(is_empty)
                    {
                        value.set_prediction(Prediction::Ty(value.ty));
                    }
                    value.ty = with_nullish(tys, value.ty, nil);
                    if let Def::Op(Op::Coerce { to, why, .. }) = &mut value.def {
                        *to = with_nullish(tys, *to, nil);
                        if *why == CoerceReason::Forced || nil & UNTYPED_OBJECT != 0 {
                            *why = CoerceReason::Upcast;
                        }
                    }
                }
                let has_assertions = contents[index] & super::has::NON_NULL_ASSERTIONS != 0;
                for number in (0..func.values.len()).filter(|_| has_assertions) {
                    if let Def::Op(Op::Coerce {
                        value,
                        to,
                        why: CoerceReason::NonNull(_),
                    }) = func.values[number].def
                        && func.ty(value) != tys.anything
                        && func.ty(value).is_some()
                        && tys.get(func.ty(value)).prims & prim::NULLISH == 0
                    {
                        func.values[number].def = Def::Op(Op::Coerce {
                            value,
                            to,
                            why: CoerceReason::Upcast,
                        });
                    }
                }
                let mut uses: Vec<u32> =
                    vec![0; if has_assertions { func.values.len() } else { 0 }];
                for block in func.blocks.iter().filter(|_| has_assertions) {
                    let mut count = |v: V| {
                        if v.is_some() {
                            uses[v.idx()] += 1;
                        }
                    };
                    for &v in &block.ops {
                        if let Some(op) = func.op(v) {
                            op.for_each_operand(&mut count);
                        }
                    }
                    if let Some(term) = &block.term {
                        term.for_each_operand(&mut count);
                    }
                }
                for block in (0..func.blocks.len()).filter(|_| has_assertions) {
                    for at in 1..func.blocks[block].ops.len() {
                        let (read, asserted) =
                            (func.blocks[block].ops[at - 1], func.blocks[block].ops[at]);
                        if let Some(&Op::Coerce {
                            value,
                            to,
                            why: CoerceReason::NonNull(_),
                        }) = func.op(asserted)
                            && value == read
                            && uses[read.idx()] == 1
                            && is_widened[read.idx()]
                            && matches!(
                                func.op(read),
                                Some(
                                    Op::ElemGet { .. }
                                        | Op::PropGet { .. }
                                        | Op::Call { .. }
                                        | Op::CallMethod { .. }
                                )
                            )
                            && func.ty(read) != tys.anything
                        {
                            func.values[read.idx()].ty = to;
                            func.values[asserted.idx()].def = Def::Op(Op::Coerce {
                                value,
                                to,
                                why: CoerceReason::Upcast,
                            });
                        }
                    }
                }
                let promise = func.result;
                func.result =
                    with_nullish(tys, func.result, reaching[nodes.result(index) as usize]);
                if func.has(func_flags::ASYNC) {
                    func.result = promise;
                }
                let entered: SmallVec<[V; 8]> =
                    func.blocks.first().map_or_else(SmallVec::new, |block| {
                        block.params.iter().copied().collect()
                    });
                let ahead = func.captures.len() + usize::from(func.has(func_flags::HAS_THIS));
                for (number, &parameter) in entered.iter().enumerate() {
                    let nil = reaching[nodes.value(index, parameter) as usize];
                    if number < func.captures.len() {
                        func.captures[number] = with_nullish(tys, func.captures[number], nil);
                    } else if number < ahead {
                        func.declared_this_type = with_nullish(tys, func.declared_this_type, nil);
                    } else if let Some(declared) = func.params.get_mut(number - ahead) {
                        *declared = with_nullish(tys, *declared, nil);
                    }
                }
            }
        },
    );
    let boolean = table.intern(Declared::prims(prim::BOOLEAN));
    const FUNCTIONS_PER_RUN: usize = 4096;
    let mut handed: Vec<(&[Func], Vec<SmallVec<[TyId; 8]>>)> = funcs
        .chunks(FUNCTIONS_PER_RUN)
        .map(|funcs| (funcs, Vec::new()))
        .collect();
    for_each_mut(&mut handed, in_parallel, &|(funcs, handed)| {
        handed.extend(funcs.iter().map(|called| {
            let receiver = called
                .has(func_flags::HAS_THIS)
                .then_some(called.declared_this_type);
            called
                .captures
                .iter()
                .copied()
                .chain(receiver)
                .chain(called.params.iter().copied())
                .collect::<SmallVec<[TyId; 8]>>()
        }));
    });
    let handed: Vec<Vec<SmallVec<[TyId; 8]>>> = handed.into_iter().map(|run| run.1).collect();
    for_each_slice(
        table,
        funcs,
        &mut has_wider_values,
        in_parallel,
        &|Slice {
              funcs,
              has_wider_values,
              tys,
              ..
          }| {
            let mut ops: Vec<V> = Vec::new();
            for (_, func) in funcs
                .iter_mut()
                .enumerate()
                .filter(|&(offset, _)| has_wider_values[offset])
            {
                let counts_tests = !has_handlers(func);
                for block in 0..func.blocks.len() {
                    let before = std::mem::take(&mut func.blocks[block].ops);
                    ops.clear();
                    ops.reserve(before.len());
                    let mut created: FxHashMap<(V, TyId), V> = FxHashMap::default();
                    for &v in &before {
                        let uses_checked_value = matches!(
                            func.op(v),
                            Some(
                                Op::Not(_)
                                    | Op::Coerce {
                                        why: CoerceReason::Upcast,
                                        ..
                                    }
                                    | Op::FieldSet { .. }
                                    | Op::NewWith { .. }
                                    | Op::GlobalSet(..)
                                    | Op::Operation { .. }
                                    | Op::PropSet { .. }
                                    | Op::CallDirect { .. }
                                    | Op::Closure { .. }
                                    | Op::ClosureOnce { .. }
                            )
                        );
                        let Some(mut op) = func.op(v).filter(|_| uses_checked_value).cloned()
                        else {
                            ops.push(v);
                            continue;
                        };
                        let mut wanted: SmallVec<[(&mut V, TyId); 4]> = SmallVec::new();
                        match &mut op {
                            Op::Not(value) => {
                                let tested = as_boolean(func, tys, &mut ops, boolean, *value);
                                if tested != *value {
                                    func.values[v.idx()].def = Def::Op(Op::Not(tested));
                                }
                            }
                            _ if !counts_tests => {}
                            Op::Coerce {
                                value,
                                to,
                                why: CoerceReason::Upcast,
                            } => wanted.push((value, *to)),
                            Op::FieldSet {
                                layout,
                                field,
                                value,
                                ..
                            } => wanted.push((
                                value,
                                layouts[layout.idx()].fields[*field as usize].declared,
                            )),
                            Op::NewWith {
                                layout,
                                name,
                                value,
                            } => {
                                if let Some(field) = layouts[layout.idx()].field(*name) {
                                    wanted.push((
                                        value,
                                        layouts[layout.idx()].fields[field as usize].declared,
                                    ));
                                }
                            }
                            Op::GlobalSet(global, value) => {
                                wanted.push((value, globals[global.idx()].declared))
                            }
                            Op::Operation {
                                which: Operation::Initialize,
                                args,
                            } => {
                                let receiver = func.ty(args[0]);
                                let view = if receiver.is_some() {
                                    tys.get(receiver).single_layout()
                                } else {
                                    None
                                };
                                let names: SmallVec<[V; 8]> = args.iter().copied().collect();
                                for (number, value) in
                                    args.iter_mut().enumerate().skip(2).step_by(2)
                                {
                                    if let (Some(view), Some(&Op::Str(name))) =
                                        (view, func.op(names[number - 1]))
                                        && let Some(field) = layouts[view.idx()].field(name)
                                    {
                                        wanted.push((
                                            value,
                                            layouts[view.idx()].fields[field as usize].declared,
                                        ));
                                    }
                                }
                            }
                            Op::PropSet { obj, name, value } => {
                                let receiver = func.ty(*obj);
                                if receiver.is_some()
                                    && let Some(view) = tys.get(receiver).single_layout()
                                    && let Some(field) = layouts[view.idx()].field(*name)
                                {
                                    wanted.push((
                                        value,
                                        layouts[view.idx()].fields[field as usize].declared,
                                    ));
                                }
                            }
                            Op::CallDirect { func: callee, args }
                            | Op::Closure {
                                func: callee,
                                captures: args,
                            }
                            | Op::ClosureOnce {
                                func: callee,
                                captures: args,
                                ..
                            } => {
                                wanted.extend(
                                    args.iter_mut().zip(
                                        handed[callee.idx() / FUNCTIONS_PER_RUN]
                                            [callee.idx() % FUNCTIONS_PER_RUN]
                                            .iter()
                                            .copied(),
                                    ),
                                );
                            }
                            _ => {}
                        }
                        let mut has_changed = false;
                        for (value, want) in wanted {
                            let fitting = narrowed(func, tys, &mut ops, &mut created, *value, want);
                            has_changed |= fitting != *value;
                            *value = fitting;
                        }
                        if has_changed {
                            func.values[v.idx()].def = Def::Op(op);
                        }
                        ops.push(v);
                    }
                    let mut term = func.blocks[block].term.take();
                    if let Some(Term::Branch { cond, .. }) = &mut term {
                        *cond = as_boolean(func, tys, &mut ops, boolean, *cond);
                    }
                    match &mut term {
                        _ if !counts_tests => {}
                        Some(Term::Return(value))
                            if !func.has(func_flags::ASYNC | func_flags::GENERATOR) =>
                        {
                            let want = func.result;
                            *value = narrowed(func, tys, &mut ops, &mut created, *value, want);
                        }
                        Some(Term::Jump(target)) => {
                            coerce_arguments(func, tys, &mut ops, &mut created, target)
                        }
                        Some(Term::Branch {
                            then, otherwise, ..
                        }) => {
                            coerce_arguments_on_edge(func, tys, then);
                            coerce_arguments_on_edge(func, tys, otherwise);
                        }
                        Some(Term::Switch { cases, default, .. }) => {
                            for case in cases {
                                coerce_arguments_on_edge(func, tys, &mut case.1);
                            }
                            coerce_arguments_on_edge(func, tys, default);
                        }
                        _ => {}
                    }
                    func.blocks[block].term = term;
                    func.blocks[block].ops = if ops.len() == before.len() {
                        before
                    } else {
                        ops.clone()
                    };
                }
            }
        },
    );
}

fn coerce_arguments_on_edge(func: &mut Func, tys: &mut Overlay<'_>, target: &mut Target) {
    let (mut ops, mut created) = (Vec::new(), FxHashMap::default());
    let mut fitted = Target {
        block: target.block,
        args: target.args.clone(),
    };
    coerce_arguments(func, tys, &mut ops, &mut created, &mut fitted);
    if ops.is_empty() {
        return;
    }
    let on_the_way = crate::id::BlockId::new(func.blocks.len());
    func.blocks.push(crate::ir::Block {
        params: Vec::new(),
        ops,
        term: Some(Term::Jump(fitted)),
    });
    *target = Target::new(on_the_way);
}

fn coerce_arguments(
    func: &mut Func,
    tys: &mut Overlay<'_>,
    ops: &mut Vec<V>,
    created: &mut FxHashMap<(V, TyId), V>,
    target: &mut Target,
) {
    let parameters: SmallVec<[V; 8]> = func.blocks[target.block.idx()]
        .params
        .iter()
        .copied()
        .collect();
    for (argument, parameter) in target.args.iter_mut().zip(parameters) {
        let want = func.ty(parameter);
        *argument = narrowed(func, tys, ops, created, *argument, want);
    }
}
