use super::*;

#[derive(Copy, Clone)]
struct DominatedNode {
    dominator: u32,
    jump: u32,
    depth: u32,
    start: u32,
}

#[derive(Default)]
pub(super) struct FlowDominators {
    pub(super) file: Option<FileId>,
    nodes: Vec<DominatedNode>,
    enclosing_loop: Vec<u32>,
    starts_of_many: Vec<u32>,
    tests: Vec<(u32, u32, u32)>,
    tests_by_property: Vec<(u32, u32, u32, u32)>,
    about_anything: Vec<(u32, u32)>,
    conditions: Option<Vec<(u32, u32)>>,
    calls: Vec<(u32, u32)>,
    last_busy_call: Vec<u32>,
    last_dominated: Vec<u32>,
    dominated: Vec<u32>,
    ascending_edges_end: Vec<u32>,
    invocations_up_to: Vec<u32>,
    most_invocations_below: Vec<u32>,
    longest_turn_below: Vec<u32>,
}

struct OpenLoop {
    label: u32,
    last: u32,
    most_invocations: u32,
    longest_turn_inside: u32,
}

struct TestRoots {
    roots: SmallVec<[(u32, u32); 4]>,
    concerns_anything: bool,
}

impl NarrowingSubjects for TestRoots {
    fn add(&mut self, root: u32, first: u32) {
        match root {
            0 => self.concerns_anything = true,
            _ => self.roots.push((root, first)),
        }
    }

    fn bails_on_computed_key(&mut self, _: ResolvesKey) -> bool {
        self.concerns_anything = true;
        true
    }

    fn add_union(&mut self) {}
}

impl FlowDominators {
    fn add(&mut self, node: u32, dominator: Option<u32>) {
        debug_assert_eq!(node as usize, self.nodes.len());
        let Some(up) = dominator else {
            self.nodes.push(DominatedNode {
                dominator: node,
                jump: node,
                depth: 0,
                start: node,
            });
            return;
        };
        let above = self.nodes[up as usize];
        let (near, far) = (above.jump, self.nodes[above.jump as usize].jump);
        let depth = |node: u32| self.nodes[node as usize].depth;
        let is_doubled = depth(up) - depth(near) == depth(near) - depth(far);
        self.nodes.push(DominatedNode {
            dominator: up,
            jump: if is_doubled { far } else { up },
            depth: above.depth + 1,
            start: above.start,
        });
    }

    fn find_common(&self, mut a: u32, mut b: u32) -> Option<u32> {
        let at = |node: u32| self.nodes[node as usize];
        while a != b {
            if at(a).depth < at(b).depth {
                std::mem::swap(&mut a, &mut b);
            }
            if at(a).depth > at(b).depth {
                let far = at(a).jump;
                a = if at(far).depth >= at(b).depth {
                    far
                } else {
                    at(a).dominator
                };
            } else if at(a).depth == 0 {
                return None;
            } else if at(a).jump != at(b).jump {
                (a, b) = (at(a).jump, at(b).jump);
            } else {
                (a, b) = (at(a).dominator, at(b).dominator);
            }
        }
        Some(a)
    }

    fn find_highest_from(&self, mut node: u32, least: u32) -> u32 {
        loop {
            let here = self.nodes[node as usize];
            let up = here.dominator;
            if up == node || up < least {
                return node;
            }
            let far = here.jump;
            node = if far >= least { far } else { up };
        }
    }

    fn find_last_test_about(&self, root: u32, start: u32, up_to: u32) -> u32 {
        let after = self.tests.partition_point(|&it| it <= (root, start, up_to));
        match self.tests[..after].last() {
            Some(&(its_root, its_start, node)) if (its_root, its_start) == (root, start) => node,
            _ => 0,
        }
    }

    fn find_last_test_about_property(&self, root: u32, first: u32, start: u32, up_to: u32) -> u32 {
        let tests = &self.tests_by_property;
        let after = tests.partition_point(|&it| it <= (root, first, start, up_to));
        match tests[..after].last() {
            Some(&(its_root, its_first, its_start, node))
                if (its_root, its_first, its_start) == (root, first, start) =>
            {
                node
            }
            _ => 0,
        }
    }

    fn find_last_about_anything(&self, start: u32, up_to: u32) -> u32 {
        Self::find_last_of(&self.about_anything, start, up_to)
    }

    fn find_first_test_about_after(&self, root: u32, start: u32, after: u32) -> u32 {
        let at = self.tests.partition_point(|&it| it <= (root, start, after));
        match self.tests.get(at) {
            Some(&(its_root, its_start, node)) if (its_root, its_start) == (root, start) => node,
            _ => u32::MAX,
        }
    }

    fn find_first_after(nodes: &[(u32, u32)], start: u32, after: u32) -> u32 {
        match nodes.get(nodes.partition_point(|&it| it <= (start, after))) {
            Some(&(its_start, node)) if its_start == start => node,
            _ => u32::MAX,
        }
    }

    fn find_tests_and_calls_around(&self, root: u32, start: u32, flow: u32) -> (u32, u32) {
        let last = self
            .find_last_test_about(root, start, flow)
            .max(self.find_last_about_anything(start, flow))
            .max(Self::find_last_of(&self.calls, start, flow));
        let next = self
            .find_first_test_about_after(root, start, flow)
            .min(Self::find_first_after(&self.about_anything, start, flow))
            .min(Self::find_first_after(&self.calls, start, flow));
        (last, next)
    }

    fn find_last_of(nodes: &[(u32, u32)], start: u32, up_to: u32) -> u32 {
        let after = nodes.partition_point(|&it| it <= (start, up_to));
        match nodes[..after].last() {
            Some(&(its_start, node)) if its_start == start => node,
            _ => 0,
        }
    }
}

#[cfg(any(test, feature = "test_support"))]
impl Checker<'_, '_> {
    pub fn set_far_walk(&mut self, steps: u32) {
        self.flow_memo.far_walk = Some(steps);
    }

    pub fn count_kept_walks(&self) -> usize {
        self.flow_memo.evolved_arrays.len()
    }

    pub fn count_cached_loop_types(&self) -> usize {
        self.flow_memo
            .flow_loop_cache
            .values()
            .map(|it| it.len())
            .sum()
    }
}

impl Checker<'_, '_> {
    #[inline(never)]
    fn index_flow_dominators(&mut self, file: FileId) {
        let bound = self.bound(file);
        let count = bound.flow.len();
        let mut index = FlowDominators {
            file: Some(file),
            nodes: Vec::with_capacity(count),
            enclosing_loop: Vec::with_capacity(count),
            ..Default::default()
        };
        let hir = self.hir(file);
        index.invocations_up_to = Vec::with_capacity(count);
        let mut turns = vec![0; count];
        let mut open: Vec<OpenLoop> = Vec::new();
        let close = |open: &mut Vec<OpenLoop>, index: &FlowDominators, turns: &mut Vec<u32>| {
            let Some(closed) = open.pop() else {
                return;
            };
            let at_label = index.invocations_up_to[closed.label as usize];
            let turn =
                closed.most_invocations.saturating_sub(at_label) + 1 + closed.longest_turn_inside;
            turns[closed.label as usize] = turn;
            if let Some(around) = open.last_mut() {
                around.most_invocations = around.most_invocations.max(closed.most_invocations);
                around.longest_turn_inside = around.longest_turn_inside.max(turn);
            }
        };
        for (i, &node) in bound.flow.iter().enumerate() {
            let i = i as u32;
            while open.last().is_some_and(|it| it.last < i) {
                close(&mut open, &index, &mut turns);
            }
            index
                .enclosing_loop
                .push(open.last().map_or(0, |it| it.label));
            let invocations = match node {
                Flow::Start { .. } | Flow::StartInvoked { .. } => 0,
                Flow::Assign {
                    target: FlowTarget::Pat(_),
                    ..
                } => 0,
                Flow::Assign {
                    target: FlowTarget::Var(d),
                    ..
                } => {
                    let stmt = bound.var_stmt[d.idx()];
                    let is_of_for_in = stmt.is_some()
                        && matches!(bound.parent_of_stmt(stmt), Parent::Stmt(owner)
                            if matches!(hir[owner].kind, StmtKind::ForIn { .. }));
                    u32::from(is_of_for_in)
                }
                Flow::Assign {
                    target: FlowTarget::Expr(e),
                    ..
                } => {
                    u32::from(bound.get_assignment_target_kind(hir, e) == AssignmentKind::Compound)
                }
                _ => 1,
            };
            let up_to = (node.antecedents(&bound.flow_edges).iter())
                .filter(|before| before.is_some() && before.0 < i)
                .fold(1, |most, before| {
                    most.max(index.invocations_up_to[before.idx()] + invocations)
                });
            index.invocations_up_to.push(up_to);
            if let Some(around) = open.last_mut() {
                around.most_invocations = around.most_invocations.max(up_to);
            }
            let earlier = |before: FlowId| (before.0 < i).then_some(before.0);
            let dominator = match node {
                Flow::Unreachable | Flow::Start { .. } | Flow::StartInvoked { .. } => None,
                Flow::Assign { before, .. }
                | Flow::ArrayMutation { before, .. }
                | Flow::Call { before, .. }
                | Flow::Cond { before, .. }
                | Flow::Switch { before, .. }
                | Flow::Reduce { before, .. } => earlier(before),
                Flow::Label { start, len } | Flow::Loop { start, len } => {
                    let edges = bound.edges(start, len);
                    if matches!(node, Flow::Loop { .. }) {
                        let last = edges.iter().filter(|it| it.is_some()).map(|it| it.0).max();
                        open.push(OpenLoop {
                            label: i,
                            last: last.unwrap_or(i).max(i),
                            most_invocations: up_to,
                            longest_turn_inside: 0,
                        });
                    }
                    let mut forward = edges.iter().filter_map(|&edge| earlier(edge));
                    let first = forward.next();
                    forward.fold(first, |common, edge| index.find_common(common?, edge))
                }
            };
            index.add(i, dominator);
        }
        while !open.is_empty() {
            close(&mut open, &index, &mut turns);
        }
        let mut counts = vec![0u32; count];
        for node in &index.nodes {
            counts[node.start as usize] += 1;
        }
        let far_walk = self.flow_memo.far_walk.unwrap_or(WORTHWHILE_FAR_SKIP);
        let many = counts.iter().enumerate().filter(|it| *it.1 > far_walk);
        index.starts_of_many = many.map(|it| it.0 as u32).collect();
        for (i, &node) in bound.flow.iter().enumerate() {
            let (i, start) = (i as u32, index.nodes[i].start);
            if counts[start as usize] <= far_walk {
                continue;
            }
            match node {
                Flow::Call { .. } => index.calls.push((start, i)),
                Flow::Switch { .. } | Flow::Reduce { .. } => index.about_anything.push((start, i)),
                Flow::Cond { expr, .. } => {
                    let mut about = TestRoots {
                        roots: SmallVec::new(),
                        concerns_anything: false,
                    };
                    self.note_test(file, expr, 0, &mut about);
                    (index.tests).extend(about.roots.iter().map(|&(root, _)| (root, start, i)));
                    (index.tests_by_property).extend(
                        about
                            .roots
                            .iter()
                            .map(|&(root, first)| (root, first, start, i)),
                    );
                    if about.concerns_anything {
                        index.about_anything.push((start, i));
                    }
                }
                _ => {}
            }
        }
        index.tests.shared_sort_unstable();
        index.tests_by_property.shared_sort_unstable();
        index.about_anything.shared_sort_unstable();
        index.calls.shared_sort_unstable();
        index.last_busy_call = (0..index.calls.len() as u32).collect();
        index.last_dominated = (0..count as u32).collect();
        index.dominated = vec![1; count];
        index
            .most_invocations_below
            .clone_from(&index.invocations_up_to);
        index.longest_turn_below = vec![0; count];
        for node in (0..count).rev() {
            let up = index.nodes[node].dominator as usize;
            if up != node {
                index.most_invocations_below[up] =
                    index.most_invocations_below[up].max(index.most_invocations_below[node]);
                index.longest_turn_below[up] = index.longest_turn_below[up]
                    .max(index.longest_turn_below[node])
                    .max(turns[node]);
                index.last_dominated[up] = index.last_dominated[up].max(index.last_dominated[node]);
                index.dominated[up] += index.dominated[node];
            }
        }
        let edges = &bound.flow_edges;
        index.ascending_edges_end = vec![0; edges.len()];
        for at in (0..edges.len()).rev() {
            index.ascending_edges_end[at] = match edges.get(at + 1) {
                Some(next) if edges[at].is_some() && next.is_some() && edges[at].0 < next.0 => {
                    index.ascending_edges_end[at + 1]
                }
                _ => at as u32 + 1,
            };
        }
        self.flow_memo.dominators = index;
    }

    fn find_last_condition(&mut self, file: FileId, start: u32, up_to: u32) -> u32 {
        let flow = &self.bound(file).flow;
        let index = &mut self.flow_memo.dominators;
        let (nodes, starts_of_many) = (&index.nodes, &index.starts_of_many);
        let conditions = index.conditions.get_or_insert_with(|| {
            let mut conditions: Vec<(u32, u32)> = (flow.iter().zip(nodes).enumerate())
                .filter(|(_, (node, _))| matches!(node, Flow::Cond { .. }))
                .map(|(i, (_, it))| (it.start, i as u32))
                .filter(|it| starts_of_many.binary_search(&it.0).is_ok())
                .collect();
            conditions.shared_sort_unstable();
            conditions
        });
        FlowDominators::find_last_of(conditions, start, up_to)
    }

    fn find_last_call_not_known_to_be_idle(
        &mut self,
        file: FileId,
        start: u32,
        least: u32,
        from: u32,
    ) -> u32 {
        let memo = &mut self.flow_memo;
        let mut at = from;
        let found = loop {
            let known = memo.dominators.last_busy_call[at as usize];
            if known == u32::MAX {
                break u32::MAX;
            }
            if known != at {
                at = known;
                continue;
            }
            let (its_start, flow) = memo.dominators.calls[at as usize];
            if its_start != start || flow <= least || !memo.is_idle_call(file, FlowId(flow)) {
                break at;
            }
            match at.checked_sub(1) {
                Some(before) => at = before,
                None => break u32::MAX,
            }
        };
        let mut at = from;
        while at != found {
            let known = std::mem::replace(&mut memo.dominators.last_busy_call[at as usize], found);
            debug_assert!(
                found == u32::MAX || known != u32::MAX && found <= known,
                "an entry only moves down: entry {at} held {known} and is given {found}"
            );
            if known == u32::MAX || known == at && at == 0 {
                break;
            }
            at = if known == at { at - 1 } else { known };
        }
        found
    }

    fn find_last_busy_call_between(
        &mut self,
        file: FileId,
        start: u32,
        least: u32,
        up_to: u32,
    ) -> u32 {
        let bound = self.bound(file);
        let calls = &self.flow_memo.dominators.calls;
        let after = calls.partition_point(|&it| it <= (start, up_to));
        let Some(from) = after.checked_sub(1) else {
            return 0;
        };
        loop {
            let found = self.find_last_call_not_known_to_be_idle(file, start, least, from as u32);
            let node = match self.flow_memo.dominators.calls.get(found as usize) {
                Some(&(its_start, node)) if its_start == start => node,
                _ => return 0,
            };
            let Flow::Call { call, .. } = bound.flow[node as usize] else {
                return node;
            };
            if node <= least {
                return node;
            }
            let (signature, is_cached) = self.effects_signature_and_is_cached(file, call);
            if is_cached {
                self.note_settled_call(file, FlowId(node), signature.is_none());
            }
            if self.flow_memo.dominators.file != Some(file) {
                return u32::MAX;
            }
            if !self.flow_memo.is_idle_call(file, FlowId(node)) {
                return node;
            }
        }
    }

    #[inline(never)]
    pub(super) fn count_antecedents_below_dominator_with_type_of(
        &mut self,
        walk: &Walk,
        at: u32,
        end: u32,
    ) -> (usize, u32) {
        self.find_antecedents_below_dominator_with_type_of(walk, at, end)
            .unwrap_or((0, 0))
    }

    fn find_antecedents_below_dominator_with_type_of(
        &mut self,
        walk: &Walk,
        at: u32,
        end: u32,
    ) -> Option<(usize, u32)> {
        let reference = &walk.reference;
        let file = reference.file;
        let root = root_key(reference.root);
        if root == 0
            || reference.unresolved.get() != 0
            || self.task.file != Some(file)
            || !walk.reduced.is_empty()
            || self.is_automatic_type(walk.declared)
        {
            return None;
        }
        if self.flow_memo.runs.file != Some(file) {
            self.index_flow_runs(file);
        }
        if self.flow_memo.dominators.file != Some(file) {
            self.index_flow_dominators(file);
        }
        let bound = self.bound(file);
        let (runs, index) = (&self.flow_memo.runs, &self.flow_memo.dominators);
        let end = index.ascending_edges_end[at as usize].min(end);
        let (&edge, later @ [_, ..]) = bound.edges(at, end - at).split_first()? else {
            return None;
        };
        let start = index.nodes[edge.idx()].start;
        if index.starts_of_many.binary_search(&start).is_err() {
            return None;
        }
        let around = |flow: u32| {
            let (last_assignment, next_assignment) =
                runs.nodes_about(root, reference, FlowId(flow));
            let (last, next) = index.find_tests_and_calls_around(root, start, flow);
            (last.max(last_assignment), next.min(next_assignment))
        };
        let (mut least, next) = around(edge.0);
        let mut label = index.enclosing_loop[edge.idx()];
        while label > least {
            let Flow::Loop { start, len } = bound.flow[label as usize] else {
                return None;
            };
            let edges = bound.edges(start, len).iter().filter(|it| it.is_some());
            if around(edges.fold(label, |last, it| last.max(it.0))).0 > label {
                least = label;
                break;
            }
            label = index.enclosing_loop[label as usize];
        }
        let mut limit = next;
        if next != u32::MAX {
            let mut label = index.enclosing_loop[next as usize];
            while label > edge.0 {
                limit = label;
                label = index.enclosing_loop[label as usize];
            }
        }
        let dominator = index.find_highest_from(edge.0, least) as usize;
        let last_dominated = index.last_dominated[dominator];
        if last_dominated - dominator as u32 + 1 != index.dominated[dominator] {
            return None;
        }
        let deeper = index.most_invocations_below[dominator]
            .saturating_sub(index.invocations_up_to[edge.idx()])
            + index.longest_turn_below[dominator];
        let count = later.partition_point(|later| later.0 < limit && later.0 <= last_dominated);
        Some((count, deeper))
    }

    pub(super) fn count_invocations_passed_by_skip(
        &self,
        flow: FlowId,
        arrived_at: FlowId,
    ) -> (u32, u32) {
        let index = &self.flow_memo.dominators;
        let up_to = &index.invocations_up_to;
        (
            up_to[flow.idx()].saturating_sub(up_to[arrived_at.idx()]),
            index.longest_turn_below[arrived_at.idx()],
        )
    }

    #[inline(never)]
    pub(super) fn skip_to_dominator(
        &mut self,
        walk: &mut Walk,
        flow: FlowId,
    ) -> Option<(FlowId, u32)> {
        let reference = &walk.reference;
        let file = reference.file;
        let root = root_key(reference.root);
        if root == 0
            || reference.unresolved.get() != 0
            || self.task.file != Some(file)
            || !walk.reduced.is_empty()
        {
            return None;
        }
        if self.flow_memo.runs.file != Some(file) {
            self.index_flow_runs(file);
        }
        let up_to = match self.bound(file).flow[flow.idx()] {
            Flow::Loop { start, len } => {
                let edges = self.bound(file).edges(start, len).iter();
                edges
                    .filter(|it| it.is_some())
                    .fold(flow.0, |last, it| last.max(it.0))
            }
            _ => flow.0,
        };
        let (last_assignment, _) =
            (self.flow_memo.runs).nodes_about(root, reference, FlowId(up_to));
        let is_automatic = self.is_automatic_type(walk.declared);
        let last_change = match is_automatic {
            true => last_assignment.max(self.flow_memo.runs.last_mutation_about(root, up_to)),
            false => last_assignment,
        };
        let worthwhile = self.flow_memo.far_walk.unwrap_or(WORTHWHILE_FAR_SKIP);
        if is_automatic && flow.0.saturating_sub(last_change) <= worthwhile {
            return None;
        }
        if self.flow_memo.dominators.file != Some(file) {
            self.index_flow_dominators(file);
        }
        let index = &self.flow_memo.dominators;
        let start = index.nodes[flow.idx()].start;
        if index.starts_of_many.binary_search(&start).is_err() {
            return None;
        }
        let last_test = match reference.path.first().map(|first| first.name.get()) {
            None => index.find_last_test_about(root, start, up_to),
            Some(AccessedName::Some(name)) => index
                .find_last_test_about_property(root, 0, start, up_to)
                .max(index.find_last_test_about_property(
                    root,
                    name.0.wrapping_add(1),
                    start,
                    up_to,
                )),
            Some(AccessedName::None | AccessedName::Unresolved(_)) => {
                index.find_last_test_about_property(root, 0, start, up_to)
            }
        };
        let least = last_change
            .max(index.enclosing_loop[flow.idx()])
            .max(last_test)
            .max(index.find_last_about_anything(start, up_to));
        let least = match is_automatic {
            true => least.max(self.find_last_condition(file, start, up_to)),
            false => least,
        };
        let index = &self.flow_memo.dominators;
        if index.nodes[flow.idx()].dominator < least || least > flow.0 {
            return None;
        }
        let least = least.max(self.find_last_busy_call_between(file, start, least, up_to));
        if least > flow.0 {
            return None;
        }
        let index = &self.flow_memo.dominators;
        if index.file != Some(file) {
            return None;
        }
        let arrived_at = index.find_highest_from(flow.0, least);
        let passed = index.nodes[flow.idx()].depth - index.nodes[arrived_at as usize].depth;
        (arrived_at != flow.0).then_some((FlowId(arrived_at), passed))
    }
}
