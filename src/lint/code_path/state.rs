//! ESLint's `CodePathState`, `ForkContext` and the static methods of `CodePathSegment`: what
//! builds the graph of one code path. The names are ESLint's, in snake case.

use super::{CodePathData, Edges, Event, Origin, Segment, SegmentData, SegmentIds, Store};
use crate::ast::{File, Node, StmtKind};
use bun_sema::atom::Atom;
use smallvec::SmallVec;

/// What a step of the analysis works with.
pub(super) struct Cx<'e, 'a> {
    pub(super) file: &'a File<'a>,
    /// ESLint's `analyzer.currentNode`.
    pub(super) node: Node<'a>,
    /// Whether an event is told with `node` even if that is a function expression.
    pub(super) keeps_function_expression: bool,
    pub(super) emit: &'e mut dyn FnMut(Event<'a>),
}

impl<'e, 'a> Cx<'e, 'a> {
    #[inline]
    pub(super) fn new(
        file: &'a File<'a>,
        node: Node<'a>,
        emit: &'e mut dyn FnMut(Event<'a>),
    ) -> Self {
        Cx {
            file,
            node,
            keeps_function_expression: false,
            emit,
        }
    }

    #[inline]
    pub(super) fn store(&self) -> &'a Store {
        &self.file.lazy.code_paths
    }

    /// The node that an event is told with: a function is a `Func`, whatever owns it.
    pub(super) fn node_of_event(&self) -> Node<'a> {
        match self.node {
            Node::Expr(e) if !self.keeps_function_expression => {
                e.as_fn().map_or(self.node, Node::Func)
            }
            Node::Stmt(stmt) => match stmt.kind() {
                StmtKind::Fn(func) => Node::Func(func),
                _ => self.node,
            },
            _ => self.node,
        }
    }
}

// ───────────────────────────── segments ─────────────────────────────

impl Store {
    /// `statements`: how many the file has, which is about how many segments it is going to have.
    pub(super) fn clear(&self, statements: usize) {
        self.paths.borrow_mut().clear();
        let mut segments = self.segments.borrow_mut();
        segments.clear();
        segments.reserve(statements);
    }

    /// To be called when the graphs are finished.
    pub(super) fn finish(&self) {
        for segment in self.segments.borrow_mut().iter_mut() {
            segment.looped_prev.sort_unstable();
        }
    }

    /// Keeps `current_segments` up to date while the events are told to the rules.
    pub(super) fn follow(&self, event: Event) {
        let (segment, starts) = match event {
            Event::SegmentStart(segment, _) | Event::UnreachableSegmentStart(segment, _) => {
                (segment, true)
            }
            Event::SegmentEnd(segment, _) | Event::UnreachableSegmentEnd(segment, _) => {
                (segment, false)
            }
            _ => return,
        };
        let path = self.segments.borrow()[segment.id() as usize].path;
        let current = &mut self.paths.borrow_mut()[path as usize].current_segments;
        match starts {
            true => current.push(segment.id()),
            false => current.retain(|id| *id != segment.id()),
        }
    }

    pub(super) fn new_code_path(&self, origin: Origin, upper: Option<u32>) -> u32 {
        let mut paths = self.paths.borrow_mut();
        let id = paths.len() as u32;
        paths.push(CodePathData {
            origin,
            upper,
            children: Vec::new(),
            initial_segment: 0,
            final_segments: Vec::new(),
            returned_segments: Vec::new(),
            thrown_segments: Vec::new(),
            current_segments: SegmentIds::new(),
            segment_count: 0,
        });
        if let Some(upper) = upper {
            paths[upper as usize].children.push(id);
        }
        id
    }

    /// Takes `count` numbers for segments that nothing is ever going to refer to.
    fn skip_numbers(&self, path: u32, count: u32) {
        self.paths.borrow_mut()[path as usize].segment_count += count;
    }

    fn new_segment(
        &self,
        segments: &mut Vec<SegmentData>,
        path: u32,
        all_prev: Edges,
        is_reachable: bool,
    ) -> u32 {
        let number = {
            let count = &mut self.paths.borrow_mut()[path as usize].segment_count;
            *count += 1;
            *count
        };
        let is_reachable_at = |&id: &u32| segments[id as usize].is_reachable;
        let prev = all_prev.iter().copied().filter(is_reachable_at).collect();
        segments.push(SegmentData {
            prev,
            all_prev,
            path,
            number,
            is_reachable,
            ..SegmentData::default()
        });
        segments.len() as u32 - 1
    }

    fn new_root(&self, path: u32) -> u32 {
        let id = self.new_segment(&mut self.segments.borrow_mut(), path, Edges::new(), true);
        self.paths.borrow_mut()[path as usize].initial_segment = id;
        id
    }

    fn new_next(&self, path: u32, all_prev: &[u32]) -> u32 {
        let segments = &mut *self.segments.borrow_mut();
        let is_reachable = all_prev
            .iter()
            .any(|&id| segments[id as usize].is_reachable);
        let all_prev = self.flatten_unused_in(segments, all_prev);
        self.new_segment(segments, path, all_prev, is_reachable)
    }

    fn new_unreachable(&self, path: u32, all_prev: &[u32]) -> u32 {
        let segments = &mut *self.segments.borrow_mut();
        let all_prev = self.flatten_unused_in(segments, all_prev);
        let id = self.new_segment(segments, path, all_prev, false);
        mark_used(segments, id);
        id
    }

    fn new_disconnected(&self, path: u32, all_prev: &[u32]) -> u32 {
        let segments = &mut *self.segments.borrow_mut();
        let is_reachable = all_prev
            .iter()
            .any(|&id| segments[id as usize].is_reachable);
        self.new_segment(segments, path, Edges::new(), is_reachable)
    }

    pub(super) fn mark_used(&self, id: u32) {
        mark_used(&mut self.segments.borrow_mut(), id);
    }

    #[inline]
    pub(super) fn is_reachable(&self, id: u32) -> bool {
        self.segments.borrow()[id as usize].is_reachable
    }

    /// `list` with each segment that has never been current replaced by those before it, and
    /// without duplicates.
    fn flatten_unused_in(&self, segments: &mut [SegmentData], list: &[u32]) -> Edges {
        if let [id] = *list {
            let segment = &segments[id as usize];
            if segment.is_used {
                return Edges::from_slice(list);
            }
            if segment.all_prev.len() <= 1 {
                return segment.all_prev.clone();
            }
        }
        let epoch = self.epoch.get().wrapping_add(1);
        self.epoch.set(epoch);
        let mut done = Edges::new();
        let mut add = |segments: &mut [SegmentData], id: u32| {
            let mark = &mut segments[id as usize].mark;
            if *mark != epoch {
                *mark = epoch;
                done.push(id);
            }
        };
        for &id in list {
            if segments[id as usize].is_used {
                add(segments, id);
                continue;
            }
            for at in 0..segments[id as usize].all_prev.len() {
                let prev = segments[id as usize].all_prev[at];
                add(segments, prev);
            }
        }
        done
    }

    fn flatten_unused(&self, list: &[u32]) -> Edges {
        self.flatten_unused_in(&mut self.segments.borrow_mut(), list)
    }

    /// `state.returnedForkContext.add(list)`
    fn add_returned(&self, path: u32, list: &[u32]) {
        let path = &mut self.paths.borrow_mut()[path as usize];
        let segments = &mut *self.segments.borrow_mut();
        for &id in list {
            path.returned_segments.push(id);
            segments[id as usize].is_returned = true;
            if !segments[id as usize].is_thrown {
                path.final_segments.push(id);
            }
        }
    }

    /// `state.thrownForkContext.add(list)`
    fn add_thrown(&self, path: u32, list: &[u32]) {
        let path = &mut self.paths.borrow_mut()[path as usize];
        let segments = &mut *self.segments.borrow_mut();
        for &id in list {
            path.thrown_segments.push(id);
            segments[id as usize].is_thrown = true;
            if !segments[id as usize].is_returned {
                path.final_segments.push(id);
            }
        }
    }
}

fn mark_used(segments: &mut [SegmentData], id: u32) {
    let segment = &mut segments[id as usize];
    if segment.is_used {
        return;
    }
    segment.is_used = true;
    let is_reachable = segment.is_reachable;
    for at in 0..segments[id as usize].all_prev.len() {
        let prev = &mut segments[segments[id as usize].all_prev[at] as usize];
        prev.all_next.push(id);
        if is_reachable {
            prev.next.push(id);
        }
    }
}

/// `elements.splice(elements.indexOf(value), 1)`, which removes the last element if `value` is
/// not among them.
fn remove_from_array(elements: &mut Edges, value: u32) {
    match elements.iter().position(|&it| it == value) {
        Some(at) => {
            elements.remove(at);
        }
        None => {
            elements.pop();
        }
    }
}

fn disconnect_segments(store: &Store, prev: &[u32], next: &[u32]) {
    let segments = &mut *store.segments.borrow_mut();
    for (&prev, &next) in prev.iter().zip(next) {
        remove_from_array(&mut segments[prev as usize].next, next);
        remove_from_array(&mut segments[prev as usize].all_next, next);
        remove_from_array(&mut segments[next as usize].prev, prev);
        remove_from_array(&mut segments[next as usize].all_prev, prev);
    }
}

fn make_looped(cx: &mut Cx, from: &[u32], to: &[u32]) {
    let store = cx.store();
    let (from, to) = (store.flatten_unused(from), store.flatten_unused(to));
    for (&from, &to) in from.iter().zip(&to) {
        let are_reachable = {
            let segments = &mut *store.segments.borrow_mut();
            let is_reachable = |id: u32| segments[id as usize].is_reachable;
            let (from_is_reachable, to_is_reachable) = (is_reachable(from), is_reachable(to));
            if to_is_reachable {
                segments[from as usize].next.push(to);
            }
            if from_is_reachable {
                segments[to as usize].prev.push(from);
            }
            segments[from as usize].all_next.push(to);
            segments[to as usize].all_prev.push(from);
            if segments[to as usize].all_prev.len() >= 2 {
                segments[to as usize].looped_prev.push(from);
            }
            from_is_reachable && to_is_reachable
        };
        if are_reachable {
            let (from, to) = (Segment::new(cx.file, from), Segment::new(cx.file, to));
            let node = cx.node_of_event();
            (cx.emit)(Event::SegmentLoop(from, to, node));
        }
    }
}

// ───────────────────────────── fork contexts ─────────────────────────────

#[derive(Copy, Clone)]
enum Make {
    Next,
    Unreachable,
    Disconnected,
}

/// A list of forking routes. Each entry has `count` segments, one for each parallel route, and
/// `list` has one entry after the other.
#[derive(Clone, Debug)]
struct ForkContext {
    path: u32,
    count: u32,
    list: SmallVec<[u32; 4]>,
}

impl ForkContext {
    fn new_empty(parent: &ForkContext) -> ForkContext {
        ForkContext {
            path: parent.path,
            count: parent.count,
            list: SmallVec::new(),
        }
    }

    fn head(&self) -> &[u32] {
        let start = self.list.len().saturating_sub(self.count as usize);
        &self.list[start..]
    }

    #[inline]
    fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    fn entries(&self) -> impl Iterator<Item = &[u32]> {
        self.list.chunks_exact(self.count as usize)
    }

    fn is_reachable(&self, store: &Store) -> bool {
        self.head().iter().any(|&id| store.is_reachable(id))
    }

    /// `createSegments`: a new segment for each parallel route, after those of the entries from
    /// `start` to `end`. A negative index counts from the end.
    fn make(&self, store: &Store, start: isize, end: isize, make: Make) -> SegmentIds {
        let count = self.count as usize;
        let len = (self.list.len() / count) as isize;
        let normalize = |index: isize| if index >= 0 { index } else { len + index };
        let (start, end) = (normalize(start).max(0), normalize(end).min(len - 1));
        let new = |all_prev: &[u32]| match make {
            Make::Next => store.new_next(self.path, all_prev),
            Make::Unreachable => store.new_unreachable(self.path, all_prev),
            Make::Disconnected => store.new_disconnected(self.path, all_prev),
        };
        if count == 1 {
            let all_prev = self.list.get(start as usize..(end + 1).max(start) as usize);
            return SegmentIds::from_slice(&[new(all_prev.unwrap_or_default())]);
        }
        let mut all_prev = Edges::new();
        (0..count)
            .map(|route| {
                all_prev.clear();
                all_prev
                    .extend((start..=end).map(|entry| self.list[entry as usize * count + route]));
                new(&all_prev)
            })
            .collect()
    }

    fn make_next(&self, store: &Store, start: isize, end: isize) -> SegmentIds {
        self.make(store, start, end, Make::Next)
    }

    fn make_unreachable(&self, store: &Store, start: isize, end: isize) -> SegmentIds {
        self.make(store, start, end, Make::Unreachable)
    }

    fn make_disconnected(&self, store: &Store, start: isize, end: isize) -> SegmentIds {
        self.make(store, start, end, Make::Disconnected)
    }

    /// `mergeExtraSegments`: joins the two halves of `segments` until there are `count`.
    fn merge_extra_segments(&self, store: &Store, segments: &[u32]) -> SegmentIds {
        let mut current = SegmentIds::from_slice(segments);
        while current.len() > self.count as usize {
            let half = current.len() / 2;
            current = (0..half)
                .map(|i| store.new_next(self.path, &[current[i], current[i + half]]))
                .collect();
        }
        current
    }

    fn add(&mut self, store: &Store, segments: &[u32]) {
        if segments.len() == self.count as usize {
            return self.list.extend_from_slice(segments);
        }
        let merged = self.merge_extra_segments(store, segments);
        if merged.len() == self.count as usize {
            self.list.extend_from_slice(&merged);
        }
    }

    fn replace_head(&mut self, store: &Store, segments: &[u32]) {
        if let ([segment], [.., head], 1) = (segments, &mut self.list[..], self.count) {
            *head = *segment;
            return;
        }
        let merged = self.merge_extra_segments(store, segments);
        if merged.len() == self.count as usize {
            self.list
                .truncate(self.list.len().saturating_sub(self.count as usize));
            self.list.extend_from_slice(&merged);
        }
    }

    fn add_all(&mut self, other: &ForkContext) {
        if other.count == self.count {
            self.list.extend_from_slice(&other.list);
        }
    }

    /// `add_all` of a context that is not needed any more. A chain of `&&` hands its routes from
    /// each operator to the next, which has none of its own yet: that takes constant time.
    fn take_all(&mut self, other: ForkContext) {
        match self.list.is_empty() && other.count == self.count {
            true => self.list = other.list,
            false => self.add_all(&other),
        }
    }

    #[inline]
    fn clear(&mut self) {
        self.list.clear();
    }
}

// ───────────────────────────── the other contexts ─────────────────────────────

struct BreakContext {
    is_breakable: bool,
    label: Option<Atom>,
    broken: ForkContext,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum ChoiceKind {
    And,
    Or,
    Nullish,
    Test,
    Loop,
}

struct ChoiceContext {
    kind: ChoiceKind,
    is_forking_as_result: bool,
    when_true: ForkContext,
    when_false: ForkContext,
    when_nullish: ForkContext,
    is_processed: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum LoopKind {
    While,
    DoWhile,
    For,
    ForIn,
    ForOf,
}

/// All of ESLint's loop contexts in one. A list of segments is empty where ESLint has `null`.
struct LoopContext {
    kind: LoopKind,
    label: Option<Atom>,
    /// Where in `State::breaks` its `brokenForkContext` is.
    break_context: usize,
    /// The value of the test, if it is a literal.
    test: Option<bool>,
    continue_dest_segments: SegmentIds,
    /// `do`-`while`
    entry_segments: SegmentIds,
    continue_fork_context: ForkContext,
    /// `for`
    end_of_init_segments: SegmentIds,
    test_segments: SegmentIds,
    end_of_test_segments: SegmentIds,
    update_segments: SegmentIds,
    end_of_update_segments: SegmentIds,
    /// `for`-`in`, `for`-`of`
    prev_segments: SegmentIds,
    left_segments: SegmentIds,
    end_of_left_segments: SegmentIds,
}

#[derive(Default)]
struct SwitchContext {
    has_case: bool,
    default_segments: SegmentIds,
    default_body_segments: SegmentIds,
    found_empty_default: bool,
    last_is_default: bool,
    fork_count: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Position {
    Try,
    Catch,
    Finally,
}

struct TryContext {
    has_finalizer: bool,
    position: Position,
    /// Stays empty without a finalizer.
    returned: ForkContext,
    thrown: ForkContext,
    last_of_try_is_reachable: bool,
    last_of_catch_is_reachable: bool,
}

/// Each `finally` block that can be left by a `return` or a `throw` doubles the number of parallel
/// routes in it. Beyond this number, which takes 8 such blocks each inside the `finally` of the
/// other, a `finally` block is analyzed as if it could only be left at its end.
const MAX_PARALLEL_ROUTES: u32 = 256;

/// ESLint's `CodePathState`. Each of its linked lists of contexts is a stack here.
pub(super) struct State {
    pub(super) path: u32,
    /// The segments that the rules have been told to have started and not ended.
    pub(super) current_segments: SegmentIds,
    forks: Vec<ForkContext>,
    choices: Vec<ChoiceContext>,
    switches: Vec<SwitchContext>,
    tries: Vec<TryContext>,
    loops: Vec<LoopContext>,
    breaks: Vec<BreakContext>,
    /// The `choiceContextCount` of each chain context.
    chains: Vec<u32>,
}

impl State {
    pub(super) fn new() -> State {
        State {
            path: 0,
            current_segments: SegmentIds::new(),
            forks: Vec::new(),
            choices: Vec::new(),
            switches: Vec::new(),
            tries: Vec::new(),
            loops: Vec::new(),
            breaks: Vec::new(),
            chains: Vec::new(),
        }
    }

    /// Makes it the state of the new code path `path`. The vectors keep their capacity.
    pub(super) fn reset(&mut self, store: &Store, path: u32) {
        self.path = path;
        self.current_segments.clear();
        self.forks.clear();
        self.choices.clear();
        self.switches.clear();
        self.tries.clear();
        self.loops.clear();
        self.breaks.clear();
        self.chains.clear();
        self.forks.push(ForkContext {
            path,
            count: 1,
            list: SmallVec::from_slice(&[store.new_root(path)]),
        });
    }

    #[inline]
    pub(super) fn head_segments(&self) -> &[u32] {
        self.forks.last().map_or(&[], ForkContext::head)
    }

    pub(super) fn is_reachable(&self, store: &Store) -> bool {
        self.forks
            .last()
            .is_some_and(|fork| fork.is_reachable(store))
    }

    /// An empty fork context with as many parallel routes as the current one.
    fn new_empty(&self) -> ForkContext {
        match self.forks.last() {
            Some(fork) => ForkContext::new_empty(fork),
            None => ForkContext {
                path: self.path,
                count: 1,
                list: SmallVec::new(),
            },
        }
    }

    // ── forks ──

    pub(super) fn push_fork_context(&mut self) {
        self.forks.push(self.new_empty());
    }

    pub(super) fn pop_fork_context(&mut self, store: &Store) {
        if self.forks.len() < 2 {
            return;
        }
        if let (Some(last), Some(fork)) = (self.forks.pop(), self.forks.last_mut()) {
            fork.replace_head(store, &last.make_next(store, 0, -1));
        }
    }

    pub(super) fn fork_path(&mut self, store: &Store) {
        if let [.., parent, fork] = &mut self.forks[..] {
            fork.add(store, &parent.make_next(store, -1, -1));
        }
    }

    pub(super) fn fork_bypass_path(&mut self, store: &Store) {
        if let [.., parent, fork] = &mut self.forks[..] {
            fork.add(store, parent.head());
        }
    }

    // ── `&&`, `||`, `??`, `?:`, `if` ──

    pub(super) fn push_choice_context(&mut self, kind: ChoiceKind, is_forking_as_result: bool) {
        self.choices.push(ChoiceContext {
            kind,
            is_forking_as_result,
            when_true: self.new_empty(),
            when_false: self.new_empty(),
            when_nullish: self.new_empty(),
            is_processed: false,
        });
    }

    fn pop_choice_context_of_loop(&mut self) -> Option<ChoiceContext> {
        self.choices.pop()
    }

    pub(super) fn pop_choice_context(&mut self, store: &Store) {
        let (Some(mut popped), Some(fork)) = (self.choices.pop(), self.forks.last_mut()) else {
            return;
        };
        match popped.kind {
            ChoiceKind::And | ChoiceKind::Or | ChoiceKind::Nullish => {
                if !popped.is_processed {
                    popped.when_true.add(store, fork.head());
                    popped.when_false.add(store, fork.head());
                    popped.when_nullish.add(store, fork.head());
                }
                if popped.is_forking_as_result {
                    if let Some(parent) = self.choices.last_mut() {
                        parent.when_true.take_all(popped.when_true);
                        parent.when_false.take_all(popped.when_false);
                        parent.when_nullish.take_all(popped.when_nullish);
                        parent.is_processed = true;
                    }
                    return;
                }
            }
            ChoiceKind::Test => {
                let side = match popped.is_processed {
                    false => &mut popped.when_true,
                    true => &mut popped.when_false,
                };
                side.clear();
                side.add(store, fork.head());
            }
            ChoiceKind::Loop => return,
        }
        popped.when_true.add_all(&popped.when_false);
        fork.replace_head(store, &popped.when_true.make_next(store, 0, -1));
    }

    pub(super) fn make_logical_right(&mut self, store: &Store) {
        let (Some(choice), Some(fork)) = (self.choices.last_mut(), self.forks.last_mut()) else {
            return;
        };
        if choice.is_processed {
            let prev = match choice.kind {
                ChoiceKind::And => &mut choice.when_true,
                ChoiceKind::Or => &mut choice.when_false,
                ChoiceKind::Nullish => &mut choice.when_nullish,
                ChoiceKind::Test | ChoiceKind::Loop => return,
            };
            fork.replace_head(store, &prev.make_next(store, 0, -1));
            prev.clear();
            choice.is_processed = false;
        } else {
            match choice.kind {
                ChoiceKind::And => {
                    choice.when_false.add(store, fork.head());
                    choice.when_nullish.add(store, fork.head());
                }
                ChoiceKind::Or => choice.when_true.add(store, fork.head()),
                ChoiceKind::Nullish => {
                    choice.when_true.add(store, fork.head());
                    choice.when_false.add(store, fork.head());
                }
                ChoiceKind::Test | ChoiceKind::Loop => return,
            }
            let next = fork.make_next(store, -1, -1);
            fork.replace_head(store, &next);
        }
    }

    pub(super) fn make_if_consequent(&mut self, store: &Store) {
        let (Some(choice), Some(fork)) = (self.choices.last_mut(), self.forks.last_mut()) else {
            return;
        };
        if !choice.is_processed {
            choice.when_true.add(store, fork.head());
            choice.when_false.add(store, fork.head());
            choice.when_nullish.add(store, fork.head());
        }
        choice.is_processed = false;
        fork.replace_head(store, &choice.when_true.make_next(store, 0, -1));
    }

    pub(super) fn make_if_alternate(&mut self, store: &Store) {
        let (Some(choice), Some(fork)) = (self.choices.last_mut(), self.forks.last_mut()) else {
            return;
        };
        choice.when_true.clear();
        choice.when_true.add(store, fork.head());
        choice.is_processed = true;
        fork.replace_head(store, &choice.when_false.make_next(store, 0, -1));
    }

    // ── optional chains ──

    pub(super) fn push_chain_context(&mut self) {
        self.chains.push(0);
    }

    pub(super) fn pop_chain_context(&mut self, store: &Store) {
        for _ in 0..self.chains.pop().unwrap_or(0) {
            self.pop_choice_context(store);
        }
    }

    pub(super) fn make_optional_node(&mut self) {
        if let Some(count) = self.chains.last_mut() {
            *count += 1;
            self.push_choice_context(ChoiceKind::Nullish, false);
        }
    }

    pub(super) fn make_optional_right(&mut self, store: &Store) {
        if !self.chains.is_empty() {
            self.make_logical_right(store);
        }
    }

    // ── `switch` ──

    pub(super) fn push_switch_context(&mut self, has_case: bool, label: Option<Atom>) {
        self.switches.push(SwitchContext {
            has_case,
            ..SwitchContext::default()
        });
        self.push_break_context(true, label);
    }

    pub(super) fn pop_switch_context(&mut self, cx: &mut Cx) {
        let store = cx.store();
        let (Some(context), Some(mut broken)) = (
            self.switches.pop(),
            self.pop_break_context(store).map(|it| it.broken),
        ) else {
            return;
        };
        let Some(fork) = self.forks.last_mut() else {
            return;
        };
        if context.fork_count == 0 {
            if !broken.is_empty() {
                broken.add(store, &fork.make_next(store, -1, -1));
                fork.replace_head(store, &broken.make_next(store, 0, -1));
            }
            return;
        }
        let last_segments = SegmentIds::from_slice(fork.head());
        self.fork_bypass_path(store);
        let last_case_segments = SegmentIds::from_slice(self.head_segments());
        broken.add(store, &last_segments);
        if !context.last_is_default {
            if context.default_body_segments.is_empty() {
                broken.add(store, &last_case_segments);
            } else {
                disconnect_segments(
                    store,
                    &context.default_segments,
                    &context.default_body_segments,
                );
                make_looped(cx, &last_case_segments, &context.default_body_segments);
            }
        }
        let remaining = self
            .forks
            .len()
            .saturating_sub(context.fork_count as usize)
            .max(1);
        self.forks.truncate(remaining);
        if let Some(fork) = self.forks.last_mut() {
            fork.replace_head(store, &broken.make_next(store, 0, -1));
        }
    }

    pub(super) fn make_switch_case_body(
        &mut self,
        store: &Store,
        is_empty: bool,
        is_default: bool,
    ) {
        let (Some(context), Some(parent)) = (self.switches.last_mut(), self.forks.last()) else {
            return;
        };
        if !context.has_case {
            return;
        }
        let mut fork = ForkContext::new_empty(parent);
        fork.add(store, &parent.make_next(store, 0, -1));
        if is_default {
            context.default_segments = SegmentIds::from_slice(parent.head());
            if is_empty {
                context.found_empty_default = true;
            } else {
                context.default_body_segments = SegmentIds::from_slice(fork.head());
            }
        } else if !is_empty && context.found_empty_default {
            context.found_empty_default = false;
            context.default_body_segments = SegmentIds::from_slice(fork.head());
        }
        context.last_is_default = is_default;
        context.fork_count += 1;
        self.forks.push(fork);
    }

    // ── `try` ──

    pub(super) fn push_try_context(&mut self, has_finalizer: bool) {
        self.tries.push(TryContext {
            has_finalizer,
            position: Position::Try,
            returned: self.new_empty(),
            thrown: self.new_empty(),
            last_of_try_is_reachable: false,
            last_of_catch_is_reachable: false,
        });
    }

    /// `getReturnContext`: the `try` statement whose `finally` block a `return` goes to. `None`
    /// if it leaves the code path.
    fn return_context(&self) -> Option<usize> {
        self.tries
            .iter()
            .rposition(|it| it.has_finalizer && it.position != Position::Finally)
    }

    /// `getThrowContext`: the `try` statement that catches a `throw`.
    fn throw_context(&self) -> Option<usize> {
        self.tries.iter().rposition(|it| {
            it.position == Position::Try || it.has_finalizer && it.position == Position::Catch
        })
    }

    fn add_returned(&mut self, store: &Store, segments: &[u32]) {
        match self.return_context() {
            Some(at) => self.tries[at].returned.add(store, segments),
            None => store.add_returned(self.path, segments),
        }
    }

    fn add_thrown(&mut self, store: &Store, segments: &[u32]) {
        match self.throw_context() {
            Some(at) => self.tries[at].thrown.add(store, segments),
            None => store.add_thrown(self.path, segments),
        }
    }

    pub(super) fn pop_try_context(&mut self, store: &Store) {
        let Some(context) = self.tries.pop() else {
            return;
        };
        if context.position == Position::Catch {
            self.pop_fork_context(store);
            return;
        }
        if context.returned.is_empty() && context.thrown.is_empty() || self.forks.len() < 2 {
            return;
        }
        let Some(popped) = self.forks.pop() else {
            return;
        };
        let (normal, leaving) = popped.head().split_at(popped.head().len() / 2);
        if !context.returned.is_empty() {
            self.add_returned(store, leaving);
        }
        if !context.thrown.is_empty() {
            self.add_thrown(store, leaving);
        }
        if let Some(fork) = self.forks.last_mut() {
            fork.replace_head(store, normal);
            if !context.last_of_try_is_reachable && !context.last_of_catch_is_reachable {
                // ESLint makes unreachable segments here and drops them.
                store.skip_numbers(self.path, fork.count);
            }
        }
    }

    pub(super) fn make_catch_block(&mut self, store: &Store) {
        let empty = self.new_empty();
        let (Some(context), Some(fork)) = (self.tries.last_mut(), self.forks.last()) else {
            return;
        };
        let mut thrown = std::mem::replace(&mut context.thrown, empty);
        context.position = Position::Catch;
        context.last_of_try_is_reachable = fork.is_reachable(store);
        thrown.add(store, fork.head());
        let thrown_segments = thrown.make_next(store, 0, -1);
        self.push_fork_context();
        self.fork_bypass_path(store);
        if let Some(fork) = self.forks.last_mut() {
            fork.add(store, &thrown_segments);
        }
    }

    pub(super) fn make_finally_block(&mut self, store: &Store) {
        let head_of_leaving_segments = SegmentIds::from_slice(self.head_segments());
        let is_after_catch = self
            .tries
            .last()
            .is_some_and(|it| it.position == Position::Catch);
        if is_after_catch {
            self.pop_fork_context(store);
        }
        let (Some(context), Some(fork)) = (self.tries.last_mut(), self.forks.last()) else {
            return;
        };
        match is_after_catch {
            true => context.last_of_catch_is_reachable = fork.is_reachable(store),
            false => context.last_of_try_is_reachable = fork.is_reachable(store),
        }
        context.position = Position::Finally;
        if context.returned.is_empty() && context.thrown.is_empty() {
            return;
        }
        if fork.count * 2 > MAX_PARALLEL_ROUTES {
            context.returned.clear();
            context.thrown.clear();
            return;
        }
        let mut segments = fork.make_next(store, -1, -1);
        let mut prev_of_leaving = Edges::new();
        for route in 0..fork.count as usize {
            prev_of_leaving.clear();
            prev_of_leaving.extend(head_of_leaving_segments.get(route).copied());
            let entries = context.returned.entries().chain(context.thrown.entries());
            prev_of_leaving.extend(entries.filter_map(|entry| entry.get(route).copied()));
            segments.push(store.new_next(self.path, &prev_of_leaving));
        }
        let mut forked = ForkContext::new_empty(fork);
        forked.count *= 2;
        forked.add(store, &segments);
        self.forks.push(forked);
    }

    pub(super) fn make_yield(&mut self, store: &Store) {
        if !self.is_reachable(store) {
            return;
        }
        let leaving = SegmentIds::from_slice(self.head_segments());
        self.add_returned(store, &leaving);
        self.add_thrown(store, &leaving);
        self.replace_head_with(store, Make::Next);
    }

    #[inline]
    pub(super) fn is_in_try(&self) -> bool {
        !self.tries.is_empty()
    }

    /// Whether `make_first_throwable_path_in_try_or_catch_block` would do anything.
    #[inline]
    pub(super) fn is_before_first_throwable(&self, store: &Store) -> bool {
        !self.tries.is_empty()
            && self
                .throw_context()
                .is_some_and(|at| self.tries[at].thrown.is_empty())
            && self.is_reachable(store)
    }

    pub(super) fn make_first_throwable_path_in_try_or_catch_block(&mut self, store: &Store) {
        if !self.is_before_first_throwable(store) {
            return;
        }
        let (Some(at), Some(fork)) = (self.throw_context(), self.forks.last()) else {
            return;
        };
        self.tries[at].thrown.add(store, fork.head());
        self.replace_head_with(store, Make::Next);
    }

    /// `forkContext.replaceHead(forkContext.make..(-1, -1))`
    fn replace_head_with(&mut self, store: &Store, make: Make) {
        if let Some(fork) = self.forks.last_mut() {
            let segments = fork.make(store, -1, -1, make);
            fork.replace_head(store, &segments);
        }
    }

    // ── loops ──

    pub(super) fn push_loop_context(&mut self, kind: LoopKind, label: Option<Atom>) {
        let continue_fork_context = self.new_empty();
        self.push_break_context(true, label);
        if matches!(kind, LoopKind::While | LoopKind::DoWhile | LoopKind::For) {
            self.push_choice_context(ChoiceKind::Loop, false);
        }
        self.loops.push(LoopContext {
            kind,
            label,
            break_context: self.breaks.len() - 1,
            test: None,
            continue_dest_segments: SegmentIds::new(),
            entry_segments: SegmentIds::new(),
            continue_fork_context,
            end_of_init_segments: SegmentIds::new(),
            test_segments: SegmentIds::new(),
            end_of_test_segments: SegmentIds::new(),
            update_segments: SegmentIds::new(),
            end_of_update_segments: SegmentIds::new(),
            prev_segments: SegmentIds::new(),
            left_segments: SegmentIds::new(),
            end_of_left_segments: SegmentIds::new(),
        });
    }

    pub(super) fn pop_loop_context(&mut self, cx: &mut Cx) {
        let store = cx.store();
        let (Some(context), Some(mut broken)) = (
            self.loops.pop(),
            self.pop_break_context(store).map(|it| it.broken),
        ) else {
            return;
        };
        let head = SegmentIds::from_slice(self.head_segments());
        match context.kind {
            LoopKind::While | LoopKind::For => {
                self.pop_choice_context_of_loop();
                make_looped(cx, &head, &context.continue_dest_segments);
            }
            LoopKind::DoWhile => {
                let Some(mut choice) = self.pop_choice_context_of_loop() else {
                    return;
                };
                if !choice.is_processed {
                    choice.when_true.add(store, &head);
                    choice.when_false.add(store, &head);
                }
                if context.test != Some(true) {
                    broken.add_all(&choice.when_false);
                }
                for entry in choice.when_true.entries() {
                    make_looped(cx, entry, &context.entry_segments);
                }
            }
            LoopKind::ForIn | LoopKind::ForOf => {
                broken.add(store, &head);
                make_looped(cx, &head, &context.left_segments);
            }
        }
        let Some(fork) = self.forks.last_mut() else {
            return;
        };
        let next = match broken.is_empty() {
            true => fork.make_unreachable(store, -1, -1),
            false => broken.make_next(store, 0, -1),
        };
        fork.replace_head(store, &next);
    }

    pub(super) fn make_while_test(&mut self, store: &Store, test: Option<bool>) {
        let (Some(context), Some(fork)) = (self.loops.last_mut(), self.forks.last_mut()) else {
            return;
        };
        let test_segments = fork.make_next(store, 0, -1);
        fork.replace_head(store, &test_segments);
        context.test = test;
        context.continue_dest_segments = test_segments;
    }

    pub(super) fn make_while_body(&mut self, store: &Store) {
        let (Some(context), Some(choice), Some(fork)) = (
            self.loops.last(),
            self.choices.last_mut(),
            self.forks.last_mut(),
        ) else {
            return;
        };
        if !choice.is_processed {
            choice.when_true.add(store, fork.head());
            choice.when_false.add(store, fork.head());
        }
        if context.test != Some(true)
            && let Some(it) = self.breaks.get_mut(context.break_context)
        {
            it.broken.add_all(&choice.when_false);
        }
        fork.replace_head(store, &choice.when_true.make_next(store, 0, -1));
    }

    pub(super) fn make_do_while_body(&mut self, store: &Store) {
        let (Some(context), Some(fork)) = (self.loops.last_mut(), self.forks.last_mut()) else {
            return;
        };
        let body_segments = fork.make_next(store, -1, -1);
        fork.replace_head(store, &body_segments);
        context.entry_segments = body_segments;
    }

    pub(super) fn make_do_while_test(&mut self, store: &Store, test: Option<bool>) {
        let (Some(context), Some(fork)) = (self.loops.last_mut(), self.forks.last_mut()) else {
            return;
        };
        context.test = test;
        if !context.continue_fork_context.is_empty() {
            context.continue_fork_context.add(store, fork.head());
            fork.replace_head(
                store,
                &context.continue_fork_context.make_next(store, 0, -1),
            );
        }
    }

    pub(super) fn make_for_test(&mut self, store: &Store, test: Option<bool>) {
        let (Some(context), Some(fork)) = (self.loops.last_mut(), self.forks.last_mut()) else {
            return;
        };
        context.end_of_init_segments = SegmentIds::from_slice(fork.head());
        let test_segments = fork.make_next(store, -1, -1);
        fork.replace_head(store, &test_segments);
        context.test = test;
        context.continue_dest_segments = test_segments.clone();
        context.test_segments = test_segments;
    }

    /// `finalizeTestSegmentsOfFor` with the current contexts.
    fn finalize_test_segments_of_for(&mut self, store: &Store) {
        let (Some(context), Some(choice), Some(fork)) = (
            self.loops.last_mut(),
            self.choices.last_mut(),
            self.forks.last(),
        ) else {
            return;
        };
        if !choice.is_processed {
            choice.when_true.add(store, fork.head());
            choice.when_false.add(store, fork.head());
            choice.when_nullish.add(store, fork.head());
        }
        if context.test != Some(true)
            && let Some(it) = self.breaks.get_mut(context.break_context)
        {
            it.broken.add_all(&choice.when_false);
        }
        context.end_of_test_segments = choice.when_true.make_next(store, 0, -1);
    }

    pub(super) fn make_for_update(&mut self, store: &Store) {
        if self
            .loops
            .last()
            .is_some_and(|it| !it.test_segments.is_empty())
        {
            self.finalize_test_segments_of_for(store);
        } else if let Some(context) = self.loops.last_mut() {
            context.end_of_init_segments =
                self.forks.last().map_or(&[][..], ForkContext::head).into();
        }
        let (Some(context), Some(fork)) = (self.loops.last_mut(), self.forks.last_mut()) else {
            return;
        };
        let update_segments = fork.make_disconnected(store, -1, -1);
        fork.replace_head(store, &update_segments);
        context.continue_dest_segments = update_segments.clone();
        context.update_segments = update_segments;
    }

    pub(super) fn make_for_body(&mut self, cx: &mut Cx) {
        let store = cx.store();
        let head = SegmentIds::from_slice(self.head_segments());
        let Some(context) = self.loops.last_mut() else {
            return;
        };
        if !context.update_segments.is_empty() {
            context.end_of_update_segments = head;
            if !context.test_segments.is_empty() {
                make_looped(cx, &context.end_of_update_segments, &context.test_segments);
            }
        } else if !context.test_segments.is_empty() {
            self.finalize_test_segments_of_for(store);
        } else {
            context.end_of_init_segments = head;
        }
        let (Some(context), Some(fork)) = (self.loops.last_mut(), self.forks.last_mut()) else {
            return;
        };
        let mut body_segments = context.end_of_test_segments.clone();
        if body_segments.is_empty() {
            let mut prev = ForkContext::new_empty(fork);
            prev.add(store, &context.end_of_init_segments);
            if !context.end_of_update_segments.is_empty() {
                prev.add(store, &context.end_of_update_segments);
            }
            body_segments = prev.make_next(store, 0, -1);
        }
        if context.continue_dest_segments.is_empty() {
            context.continue_dest_segments = body_segments.clone();
        }
        fork.replace_head(store, &body_segments);
    }

    pub(super) fn make_for_in_of_left(&mut self, store: &Store) {
        let (Some(context), Some(fork)) = (self.loops.last_mut(), self.forks.last_mut()) else {
            return;
        };
        let left_segments = fork.make_disconnected(store, -1, -1);
        context.prev_segments = SegmentIds::from_slice(fork.head());
        fork.replace_head(store, &left_segments);
        context.continue_dest_segments = left_segments.clone();
        context.left_segments = left_segments;
    }

    pub(super) fn make_for_in_of_right(&mut self, store: &Store) {
        let (Some(context), Some(fork)) = (self.loops.last_mut(), self.forks.last_mut()) else {
            return;
        };
        let mut temp = ForkContext::new_empty(fork);
        temp.add(store, &context.prev_segments);
        let right_segments = temp.make_next(store, -1, -1);
        context.end_of_left_segments = SegmentIds::from_slice(fork.head());
        fork.replace_head(store, &right_segments);
    }

    pub(super) fn make_for_in_of_body(&mut self, cx: &mut Cx) {
        let store = cx.store();
        let (Some(context), Some(fork)) = (self.loops.last(), self.forks.last_mut()) else {
            return;
        };
        let mut temp = ForkContext::new_empty(fork);
        temp.add(store, &context.end_of_left_segments);
        let body_segments = temp.make_next(store, -1, -1);
        make_looped(cx, fork.head(), &context.left_segments);
        if let Some(it) = self.breaks.get_mut(context.break_context) {
            it.broken.add(store, fork.head());
        }
        fork.replace_head(store, &body_segments);
    }

    // ── `break`, `continue`, `return`, `throw` ──

    pub(super) fn push_break_context(&mut self, is_breakable: bool, label: Option<Atom>) {
        self.breaks.push(BreakContext {
            is_breakable,
            label,
            broken: self.new_empty(),
        });
    }

    fn pop_break_context(&mut self, store: &Store) -> Option<BreakContext> {
        let mut context = self.breaks.pop()?;
        if !context.is_breakable
            && !context.broken.is_empty()
            && let Some(fork) = self.forks.last_mut()
        {
            context.broken.add(store, fork.head());
            fork.replace_head(store, &context.broken.make_next(store, 0, -1));
        }
        Some(context)
    }

    /// `popBreakContext` of a labeled statement that is neither a loop nor a `switch`.
    pub(super) fn pop_break_context_of_label(&mut self, store: &Store) {
        self.pop_break_context(store);
    }

    pub(super) fn make_break(&mut self, store: &Store, label: Option<Atom>) {
        if !self.is_reachable(store) {
            return;
        }
        let context = self.breaks.iter_mut().rev().find(|it| match label {
            Some(_) => it.label == label,
            None => it.is_breakable,
        });
        if let (Some(context), Some(fork)) = (context, self.forks.last()) {
            context.broken.add(store, fork.head());
        }
        self.replace_head_with(store, Make::Unreachable);
    }

    pub(super) fn make_continue(&mut self, cx: &mut Cx, label: Option<Atom>) {
        let store = cx.store();
        if !self.is_reachable(store) {
            return;
        }
        let context = match label {
            Some(_) => self.loops.iter_mut().rev().find(|it| it.label == label),
            None => self.loops.last_mut(),
        };
        if let (Some(context), Some(fork)) = (context, self.forks.last()) {
            if context.continue_dest_segments.is_empty() {
                context.continue_fork_context.add(store, fork.head());
            } else {
                make_looped(cx, fork.head(), &context.continue_dest_segments);
                if matches!(context.kind, LoopKind::ForIn | LoopKind::ForOf)
                    && let Some(it) = self.breaks.get_mut(context.break_context)
                {
                    it.broken.add(store, fork.head());
                }
            }
        }
        self.replace_head_with(store, Make::Unreachable);
    }

    pub(super) fn make_return(&mut self, store: &Store) {
        if self.is_reachable(store) {
            let head = SegmentIds::from_slice(self.head_segments());
            self.add_returned(store, &head);
            self.replace_head_with(store, Make::Unreachable);
        }
    }

    pub(super) fn make_throw(&mut self, store: &Store) {
        if self.is_reachable(store) {
            let head = SegmentIds::from_slice(self.head_segments());
            self.add_thrown(store, &head);
            self.replace_head_with(store, Make::Unreachable);
        }
    }

    pub(super) fn make_final(&mut self, store: &Store) {
        if self
            .current_segments
            .first()
            .is_some_and(|&id| store.is_reachable(id))
        {
            store.add_returned(self.path, &self.current_segments);
        }
    }
}
