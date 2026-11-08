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
    calls: Vec<(u32, u32)>,
    last_busy_call: Vec<u32>,
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
        let after = self
            .about_anything
            .partition_point(|&it| it <= (start, up_to));
        match self.about_anything[..after].last() {
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
        let mut open: Vec<(u32, u32)> = Vec::new();
        for (i, &node) in bound.flow.iter().enumerate() {
            let i = i as u32;
            while open.last().is_some_and(|it| it.1 < i) {
                open.pop();
            }
            index.enclosing_loop.push(open.last().map_or(0, |it| it.0));
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
                        open.push((i, last.unwrap_or(i).max(i)));
                    }
                    let mut forward = edges.iter().filter_map(|&edge| earlier(edge));
                    let first = forward.next();
                    forward.fold(first, |common, edge| index.find_common(common?, edge))
                }
            };
            index.add(i, dominator);
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
        self.flow_memo.dominators = index;
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
        let index = &self.flow_memo.dominators;
        let up_to = match self.bound(file).flow[flow.idx()] {
            Flow::Loop { start, len } => {
                let edges = self.bound(file).edges(start, len).iter();
                edges
                    .filter(|it| it.is_some())
                    .fold(flow.0, |last, it| last.max(it.0))
            }
            _ => flow.0,
        };
        let start = index.nodes[flow.idx()].start;
        if index.starts_of_many.binary_search(&start).is_err() {
            return None;
        }
        let (last_assignment, _) =
            (self.flow_memo.runs).nodes_about(root, reference, FlowId(up_to));
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
        let least = last_assignment
            .max(index.enclosing_loop[flow.idx()])
            .max(last_test)
            .max(index.find_last_about_anything(start, up_to));
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
