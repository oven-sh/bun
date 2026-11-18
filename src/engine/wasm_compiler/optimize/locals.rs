//! The values of locals.
//!
//! Each binding has the one that was made before it on the way from the entry as its parent, and an edge remembers
//! its place in that tree. Where edges meet, a local that was bound on the way is bound to a merge, which becomes a
//! parameter of the block only if the local is read and the values differ.

use bun_engine_codegen::ir::{Block, Edge, Function, Op, Value};
use bun_engine_wasm_format::{RefType, Types, ValType};

use super::translator::ir_type;

const NONE: u32 = u32::MAX;
const OPEN: u32 = u32::MAX;
const ROOT: u32 = 0;

#[derive(Clone, Copy)]
pub(super) struct Typed {
    pub(super) value: Value,
    /// A bound, which may be below the type that validation finds.
    pub(super) ty: ValType,
}

/// The least type above both, or `bound`, which is above both.
pub(super) fn common_type(types: &Types, a: ValType, b: ValType, bound: ValType) -> ValType {
    if a == b {
        return a;
    }
    let (Some(a), Some(b), Some(bound)) = (a.as_ref(), b.as_ref(), bound.as_ref()) else {
        return bound;
    };
    let heap_type = if types.is_heap_subtype(a.heap_type(), b.heap_type()) {
        b.heap_type()
    } else if types.is_heap_subtype(b.heap_type(), a.heap_type()) {
        a.heap_type()
    } else {
        bound.heap_type()
    };
    RefType::new(heap_type, a.is_nullable() || b.is_nullable()).into()
}

#[derive(Clone, Copy)]
struct Binding {
    /// `NONE` while `merge` stands for it.
    value: Value,
    ty: ValType,
    merge: u32,
    local: u32,
    shadowed: u32,
    parent: u32,
    /// The snapshots with a time in `start..end` have it on their way.
    start: u32,
    end: u32,
}

#[derive(Clone, Copy)]
pub(super) struct Snapshot {
    time: u32,
    head: u32,
}

#[derive(Clone, Copy)]
struct Merge {
    value: Value,
    ty: ValType,
    declared: ValType,
    local: u32,
    join: u32,
    /// What holds where the ways part, or before the loop.
    entry: u32,
    /// What an edge passes on if there is no source on its way.
    default: u32,
    first_source: u32,
    is_complete: bool,
}

/// The bindings of a local on the ways to a join, the oldest first.
#[derive(Clone, Copy)]
struct Source {
    binding: u32,
    next: u32,
}

#[derive(Clone, Copy)]
struct Join {
    block: Block,
    /// `NONE` unless the block heads a loop, whose arrivals are the edges back.
    entry_edge: Edge,
    first_arrival: u32,
    arrival_count: u32,
    first_merge: u32,
    merge_count: u32,
    head: u32,
    is_open: bool,
    has_dead_params: bool,
}

#[derive(Clone, Copy)]
pub(super) struct OpenLoop(u32);

#[derive(Default)]
pub(super) struct Locals {
    current: Vec<u32>,
    declared: Vec<ValType>,
    last_merge: Vec<u32>,
    last_redone: Vec<u32>,
    bindings: Vec<Binding>,
    merges: Vec<Merge>,
    sources: Vec<Source>,
    joins: Vec<Join>,
    arrivals: Vec<(Edge, u32)>,
    head: u32,
    clock: u32,
    restorations: u32,
    effort: usize,
    unresolved: Vec<u32>,
    scratch: Vec<u32>,
    incoming: Vec<Edge>,
}

impl Locals {
    pub(super) fn clear(&mut self) {
        self.truncate(0);
        self.bindings.clear();
        self.merges.clear();
        self.sources.clear();
        self.joins.clear();
        self.arrivals.clear();
        (self.head, self.clock, self.restorations, self.effort) = (ROOT, 1, 0, 0);
        self.push_initial(Typed {
            value: Value::NONE,
            ty: ValType::I32,
        });
    }

    pub(super) fn len(&self) -> u32 {
        self.current.len() as u32
    }

    /// The steps taken so far, apart from those that each instruction takes a few of.
    pub(super) fn effort(&self) -> usize {
        self.effort
    }

    fn push_initial(&mut self, Typed { value, ty }: Typed) {
        self.bindings.push(Binding {
            value,
            ty,
            merge: NONE,
            local: NONE,
            shadowed: NONE,
            parent: ROOT,
            start: 0,
            end: OPEN,
        });
    }

    pub(super) fn declare(&mut self, count: u32, declared: ValType, initial: Typed) {
        let len = self.current.len() + count as usize;
        self.current.resize(len, self.bindings.len() as u32);
        self.declared.resize(len, declared);
        self.last_merge.resize(len, NONE);
        self.last_redone.resize(len, 0);
        self.push_initial(initial);
    }

    /// None of those that go is bound on the way to here. Edges that were taken may still have their bindings.
    pub(super) fn truncate(&mut self, len: u32) {
        self.current.truncate(len as usize);
        self.declared.truncate(len as usize);
        self.last_merge.truncate(len as usize);
        self.last_redone.truncate(len as usize);
    }

    #[inline]
    pub(super) fn get(&mut self, function: &mut Function, types: &Types, local: u32) -> Typed {
        let id = self.current[local as usize];
        let Binding { value, ty, .. } = self.bindings[id as usize];
        if value.is_none() {
            return self.resolve(function, types, id);
        }
        Typed { value, ty }
    }

    #[inline]
    pub(super) fn set(&mut self, local: u32, Typed { value, ty }: Typed) {
        self.bind(local, value, ty, NONE);
    }

    /// If the local still has the value, it has the type from here on. Returns what it has given up for that.
    pub(super) fn refine(&mut self, types: &Types, local: u32, refined: Typed) -> Option<Typed> {
        let Binding { value, ty, .. } = self.bindings[self.current[local as usize] as usize];
        let narrows =
            value == refined.value && ty != refined.ty && types.is_subtype(refined.ty, ty);
        narrows.then(|| {
            self.set(local, refined);
            Typed { value, ty }
        })
    }

    #[inline]
    fn bind(&mut self, local: u32, value: Value, ty: ValType, merge: u32) {
        let current = &mut self.current[local as usize];
        let old = &mut self.bindings[*current as usize];
        if old.start == self.clock {
            (old.value, old.ty, old.merge) = (value, ty, merge);
            return;
        }
        let id = self.bindings.len() as u32;
        self.bindings.push(Binding {
            value,
            ty,
            merge,
            local,
            shadowed: core::mem::replace(current, id),
            parent: core::mem::replace(&mut self.head, id),
            start: self.clock,
            end: OPEN,
        });
    }

    #[inline]
    pub(super) fn snapshot(&mut self) -> Snapshot {
        self.clock += 1;
        Snapshot {
            time: self.clock - 1,
            head: self.head,
        }
    }

    pub(super) fn restore(&mut self, snapshot: Snapshot) {
        self.go_to(snapshot.head);
    }

    /// What was left is bound again, so that a binding and what descends from it stay consecutive.
    fn go_to(&mut self, mut target: u32) {
        self.scratch.clear();
        self.restorations += 1;
        while self.bindings[target as usize].end != OPEN {
            let Binding { local, parent, .. } = self.bindings[target as usize];
            if let Some(last) = self.last_redone.get_mut(local as usize)
                && core::mem::replace(last, self.restorations) != self.restorations
            {
                self.scratch.push(target);
            }
            target = parent;
            self.effort += 1;
        }
        while self.head != target {
            let is_last = self.head as usize + 1 == self.bindings.len();
            let binding = &mut self.bindings[self.head as usize];
            self.current[binding.local as usize] = binding.shadowed;
            self.head = binding.parent;
            binding.end = self.clock;
            if is_last && binding.start == self.clock {
                self.bindings.pop();
            }
        }
        for index in 0..self.scratch.len() {
            let left = self.bindings[self.scratch[index] as usize];
            self.bind(left.local, left.value, left.ty, left.merge);
        }
    }

    /// Visits what is on the way to each arrival but not to the first, the newest first.
    fn walk_later_ways(
        &mut self,
        arrivals: &[(Edge, Snapshot)],
        mut visit: impl FnMut(&mut Self, u32),
    ) {
        for [(_, earlier), (_, later)] in arrivals.array_windows().rev() {
            let mut id = later.head;
            while self.bindings[id as usize].start > earlier.time {
                visit(self, id);
                id = self.bindings[id as usize].parent;
            }
        }
    }

    fn add_source(&mut self, merge: u32, binding: u32) {
        let id = self.sources.len() as u32;
        let next = core::mem::replace(&mut self.merges[merge as usize].first_source, id);
        self.sources.push(Source { binding, next });
    }

    fn add_merge(&mut self, local: u32, entry: u32, default: u32) -> u32 {
        let (id, declared) = (self.merges.len() as u32, self.declared[local as usize]);
        self.merges.push(Merge {
            value: Value::NONE,
            ty: declared,
            declared,
            local,
            join: self.joins.len() as u32,
            entry,
            default,
            first_source: NONE,
            is_complete: false,
        });
        self.last_merge[local as usize] = id;
        id
    }

    fn set_arrivals(&mut self, join: u32, arrivals: &[(Edge, Snapshot)]) {
        let join = &mut self.joins[join as usize];
        (join.first_arrival, join.arrival_count) =
            (self.arrivals.len() as u32, arrivals.len() as u32);
        let times = arrivals.iter().map(|&(edge, from)| (edge, from.time));
        self.arrivals.extend(times);
    }

    /// `arrivals` are all the edges to `block`, in the order of their snapshots.
    pub(super) fn join(&mut self, block: Block, arrivals: &[(Edge, Snapshot)]) {
        let first_merge = self.merges.len() as u32;
        let visit = |this: &mut Self, id: u32| {
            let Binding {
                local, shadowed, ..
            } = this.bindings[id as usize];
            this.effort += 1;
            let Some(&(mut merge)) = this.last_merge.get(local as usize) else {
                return;
            };
            if merge < first_merge || merge == NONE {
                merge = this.add_merge(local, NONE, NONE);
            }
            this.merges[merge as usize].default = shadowed;
            this.add_source(merge, id);
        };
        self.walk_later_ways(arrivals, visit);
        let (mut common, last) = (arrivals[0].1.head, arrivals[arrivals.len() - 1].1);
        while self.bindings[common as usize].end <= last.time {
            visit(self, common);
            common = self.bindings[common as usize].parent;
        }

        self.go_to(common);
        let merge_count = self.merges.len() as u32 - first_merge;
        if merge_count == 0 {
            return;
        }
        for merge in first_merge..first_merge + merge_count {
            let Merge { local, ty, .. } = self.merges[merge as usize];
            self.bind(local, Value::NONE, ty, merge);
        }
        let join = self.add_join(block, Edge::NONE, first_merge);
        self.set_arrivals(join, arrivals);
    }

    fn add_join(&mut self, block: Block, entry_edge: Edge, first_merge: u32) -> u32 {
        self.joins.push(Join {
            block,
            entry_edge,
            first_arrival: 0,
            arrival_count: 0,
            first_merge,
            merge_count: self.merges.len() as u32 - first_merge,
            head: self.head,
            is_open: !entry_edge.is_none(),
            has_dead_params: false,
        });
        self.joins.len() as u32 - 1
    }

    /// `assigned` are the locals that may have another value when control comes back to `header`.
    pub(super) fn open_loop(
        &mut self,
        header: Block,
        entry_edge: Edge,
        assigned: impl Iterator<Item = u32>,
    ) -> OpenLoop {
        let first_merge = self.merges.len() as u32;
        self.clock += 1;
        for local in assigned {
            let known = self.last_merge[local as usize];
            self.effort += 1;
            if known < first_merge || known == NONE {
                let entry = self.current[local as usize];
                let merge = self.add_merge(local, entry, self.bindings.len() as u32);
                self.bind(local, Value::NONE, self.declared[local as usize], merge);
            }
        }
        self.clock += 1;
        OpenLoop(self.add_join(header, entry_edge, first_merge))
    }

    /// `arrivals` are all the edges back to the header, in the order of their snapshots.
    pub(super) fn close_loop(
        &mut self,
        function: &mut Function,
        types: &Types,
        OpenLoop(id): OpenLoop,
        arrivals: &[(Edge, Snapshot)],
    ) {
        self.set_arrivals(id, arrivals);
        self.joins[id as usize].is_open = false;
        let join = self.joins[id as usize];
        let merges = join.first_merge..join.first_merge + join.merge_count;
        for merge in merges.clone() {
            self.last_merge[self.merges[merge as usize].local as usize] = merge;
        }
        let visit = |this: &mut Self, id: u32| {
            let local = this.bindings[id as usize].local;
            this.effort += 1;
            if let Some(&merge) = this.last_merge.get(local as usize)
                && merges.contains(&merge)
            {
                this.add_source(merge, id);
            }
        };
        self.walk_later_ways(arrivals, visit);
        let mut id = arrivals.first().map_or(ROOT, |first| first.1.head);
        while id > join.head {
            visit(self, id);
            id = self.bindings[id as usize].parent;
        }

        for &(edge, _) in arrivals {
            for position in function.args(edge).len()..function.params(join.block).len() {
                function.push_arg(edge, function.params(join.block)[position]);
            }
        }
        for merge in merges {
            if !self.merges[merge as usize].value.is_none() {
                self.complete(function, types, merge);
            }
        }
    }

    /// Once all code is there.
    pub(super) fn finish(&mut self, function: &mut Function) {
        let mut has_aliases = false;
        for join in self.joins.iter().filter(|join| join.has_dead_params) {
            let arrivals = &self.arrivals[join.first_arrival as usize..];
            self.incoming.clear();
            self.incoming.push(join.entry_edge);
            self.incoming
                .extend((arrivals.iter().take(join.arrival_count as usize)).map(|&(edge, _)| edge));
            function.drop_dead_params(join.block, &self.incoming);
            has_aliases = true;
        }
        if has_aliases {
            function.resolve_aliases();
        }
    }

    #[inline(never)]
    fn resolve(&mut self, function: &mut Function, types: &Types, id: u32) -> Typed {
        let merge = self.bindings[id as usize].merge;
        if self.merges[merge as usize].value.is_none() {
            self.complete(function, types, merge);
        }
        let Merge { value, ty, .. } = self.merges[merge as usize];
        let binding = &mut self.bindings[id as usize];
        (binding.value, binding.ty) = (value, ty);
        Typed { value, ty }
    }

    fn complete(&mut self, function: &mut Function, types: &Types, merge: u32) {
        self.unresolved.push(merge);
        while let Some(&merge) = self.unresolved.last() {
            let Merge {
                join, is_complete, ..
            } = self.merges[merge as usize];
            let join = self.joins[join as usize];
            let is_done = is_complete
                || if join.entry_edge.is_none() {
                    self.merge_ways(function, types, merge, &join)
                } else {
                    self.merge_turns(function, merge, &join)
                };
            if is_done {
                self.unresolved.pop();
            }
        }
    }

    /// With a value of `NONE` if the merge that the binding stands for has none yet.
    fn known(&self, function: &Function, id: u32) -> Typed {
        let binding = &self.bindings[id as usize];
        let (value, ty) = if binding.value.is_none() {
            let merge = &self.merges[binding.merge as usize];
            (merge.value, merge.ty)
        } else {
            (binding.value, binding.ty)
        };
        Typed {
            value: value
                .expand()
                .map_or(value, |value| function.resolve(value)),
            ty,
        }
    }

    /// Puts the binding that each arrival passes on in `scratch`.
    fn find_passed(&mut self, merge: u32, join: &Join) {
        let Merge {
            default: mut passed,
            first_source: mut next,
            ..
        } = self.merges[merge as usize];
        self.scratch.clear();
        let arrivals = &self.arrivals[join.first_arrival as usize..];
        for &(_, time) in arrivals.iter().take(join.arrival_count as usize) {
            while let Some(source) = self.sources.get(next as usize)
                && self.bindings[source.binding as usize].start <= time
            {
                (passed, next) = (source.binding, source.next);
            }
            while self.bindings[passed as usize].end <= time {
                passed = self.bindings[passed as usize].shadowed;
            }
            self.scratch.push(passed);
        }
        self.effort += self.scratch.len();
    }

    /// Returns whether all bindings in `scratch` have a value. The others are to be resolved first.
    fn require_values(&mut self, function: &Function) -> bool {
        let (before, mut previous) = (self.unresolved.len(), NONE);
        for &id in &self.scratch {
            if core::mem::replace(&mut previous, id) != id
                && self.known(function, id).value.is_none()
            {
                self.unresolved.push(self.bindings[id as usize].merge);
            }
        }
        self.unresolved.len() == before
    }

    fn settle(&mut self, merge: u32, Typed { value, ty }: Typed) {
        let merge = &mut self.merges[merge as usize];
        (merge.value, merge.ty, merge.is_complete) = (value, ty, true);
    }

    fn merge_ways(
        &mut self,
        function: &mut Function,
        types: &Types,
        merge: u32,
        join: &Join,
    ) -> bool {
        self.find_passed(merge, join);
        if !self.require_values(function) {
            return false;
        }
        let declared = self.merges[merge as usize].declared;
        let mut merged = self.known(function, self.scratch[0]);
        let mut differ = false;
        for &id in &self.scratch[1..] {
            let other = self.known(function, id);
            differ |= other.value != merged.value;
            merged.ty = common_type(types, merged.ty, other.ty, declared);
        }
        if differ {
            merged.value = function.add_param(join.block, function.type_of(merged.value));
            let arrivals = &self.arrivals[join.first_arrival as usize..];
            for (&id, &(edge, _)) in self.scratch.iter().zip(arrivals) {
                function.push_arg(edge, self.known(function, id).value);
            }
        }
        self.settle(merge, merged);
        true
    }

    fn merge_turns(&mut self, function: &mut Function, merge: u32, join: &Join) -> bool {
        let Merge {
            value: mut param,
            declared,
            entry,
            default,
            ..
        } = self.merges[merge as usize];
        let arrivals =
            join.first_arrival as usize..(join.first_arrival + join.arrival_count) as usize;
        self.find_passed(merge, join);
        let stays = !join.is_open && self.scratch.iter().all(|&id| id == default);
        if param.is_none() && !stays {
            param = function.add_param(join.block, ir_type(declared));
            function.push_arg(join.entry_edge, param);
            for &(edge, _) in &self.arrivals[arrivals.clone()] {
                function.push_arg(edge, param);
            }
            self.merges[merge as usize].value = param;
        }
        if param.is_none() {
            self.scratch.clear();
        }
        self.scratch.push(entry);
        if !self.require_values(function) {
            return false;
        }
        let entry = self.known(function, entry);
        if param.is_none() {
            self.settle(merge, entry);
            return true;
        }

        let Op::Param(position) = *function.op(param) else {
            unreachable!("only a complete merge loses its parameter")
        };
        function.args_mut(join.entry_edge)[position as usize] = entry.value;
        if join.is_open {
            return true;
        }
        let mut changes = false;
        for (&id, &(edge, _)) in self.scratch.iter().zip(&self.arrivals[arrivals]) {
            let value = self.known(function, id).value;
            changes |= value != param && value != entry.value;
            function.args_mut(edge)[position as usize] = value;
        }
        if changes {
            self.merges[merge as usize].is_complete = true;
        } else {
            function.replace_param(param, entry.value);
            let join = self.merges[merge as usize].join;
            self.joins[join as usize].has_dead_params = true;
            self.settle(merge, entry);
        }
        true
    }
}
