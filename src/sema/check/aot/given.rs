//! What gets into a place beyond what its type says.
//!
//! A place for a number or a boolean is kept unboxed, and has room for `undefined` or `null` only if its type says so. The types of TypeScript leave them
//! out where there need be no value: `list[i]`, `table[key]`, `a && b` with an `a` that is not there. ECMAScript throws nothing then: the value travels. So a
//! place that it may reach gets the room.
//!
//! Whoever links the program reports how values get from place to place: nodes, which are numbers here, and what connects them. That is sets.
//! What follows from them is worked out here, once, when all are in. Nothing is asked of a type.
//!
//! A value is not handed on from where a test has shown that it is there: `x && ..`, `if (!x) return`, `x !== undefined`. A test holds for all that
//! the way it has gone dominates: a value of the program as it is linked never changes.

use crate::util::{FxHashMap, InParallel, for_each_mut};

/// What may be in a place beyond its type, and what a test shows a value not to be.
pub const UNDEFINED: u8 = 1;
pub const NULL: u8 = 1 << 1;
pub const STRANGER: u8 = 1 << 2;

/// In the place of a jump: none.
pub const NO_JUMP: u32 = u32::MAX;

#[derive(Default)]
pub struct NilEdges {
    /// Whatever the first holds the second may: from a place to a read of it, from the result of a function to a call.
    pub edges: Vec<(u32, u32, u8)>,
    /// What comes into being in a node whatever is tested: what somebody hands over of whom nothing is known.
    pub origins: Vec<(u32, u8)>,
}

/// Values are numbered within the function, as whoever reports likes: a test and a use mean the same value by the same number.
#[derive(Default)]
pub struct NilFlowsInFunction {
    /// It starts at block 0.
    pub blocks: u32,
    pub jumps: Vec<Jump>,
    pub origins: Vec<Origin>,
    pub uses: Vec<Use>,
}

pub struct Jump {
    pub from: u32,
    pub to: u32,
    /// What is shown of which value where control goes this way.
    pub shown: Vec<(u32, u8)>,
}

/// Where a value that its type leaves out comes into being.
pub struct Origin {
    pub node: u32,
    pub nil: u8,
    pub block: u32,
    /// Not where one of these is shown.
    pub unless: Vec<(u32, u8)>,
}

/// A value gets from one node to another.
pub struct Use {
    pub value: u32,
    pub from: u32,
    pub to: u32,
    pub block: u32,
    /// It is handed on by that jump of the function, out of `block`. `NO_JUMP`: by an operation in the block.
    pub jump: u32,
}

/// What a function does to a place that it reads and stores to by name, `o.n`, where that is a field for sure.
pub enum PlaceEvent {
    /// `value`: as a test means it.
    Read { place: u32, value: u32 },
    /// `may_be_nil`: by the type of the value.
    Store { place: u32, value: u32, may_be_nil: bool },
    /// Code runs of which nothing is known.
    Anything,
}

/// `if (!node.id) { node.id = next; next++ } return node.id`: the last read finds what the store has put there, or what the test has found. By the value that is read: the values one of
/// which it is, where all of them are stored by the function itself and none may be nil by its type. What a test has shown to be there is left out: an empty list says that it is there.
/// A read that is not listed may find anything that the place can hold.
///
/// `events`: by block, in order. `names`: by place: two places of one name may be one place. What goes round a loop is not followed.
pub fn stored_values_read(function: &NilFlowsInFunction, events: &[Vec<PlaceEvent>], names: &[u32]) -> FxHashMap<u32, Vec<u32>> {
    const NIL: u8 = UNDEFINED | NULL;
    // By place: the values one of which it holds, each with whether it may be nil. No entry: nothing is known.
    type Held = FxHashMap<u32, Vec<(u32, bool)>>;
    let blocks = function.blocks as usize;
    let mut found: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    if blocks == 0 || events.iter().all(|events| !events.iter().any(|event| matches!(event, PlaceEvent::Read { .. }))) {
        return found;
    }
    let mut has_event = vec![false; names.len()];
    let place_of = |event: &PlaceEvent| match *event {
        PlaceEvent::Read { place, .. } | PlaceEvent::Store { place, .. } => Some(place),
        PlaceEvent::Anything => None,
    };
    if !events.iter().flatten().filter_map(place_of).any(|place| std::mem::replace(&mut has_event[place as usize], true)) {
        return found;
    }
    let (mut arriving, mut leaving): (Vec<Vec<u32>>, Vec<Vec<u32>>) = (vec![Vec::new(); blocks], vec![Vec::new(); blocks]);
    for (index, jump) in function.jumps.iter().enumerate() {
        arriving[jump.to as usize].push(index as u32);
        leaving[jump.from as usize].push(index as u32);
    }
    let loop_of = loops_of(function, &leaving);
    // At the end of each block that has been gone through.
    let mut at_end: Vec<Option<Held>> = vec![None; blocks];
    let mut pending: Vec<u32> = vec![0];
    let mut is_done = vec![false; blocks];
    while let Some(block) = pending.pop() {
        let block = block as usize;
        if is_done[block] {
            continue;
        }
        // A block waits for all that lead to it, but for those that it leads to itself: of what comes that way nothing is known.
        let mut held: Option<Held> = None;
        for &index in &arriving[block] {
            let jump = &function.jumps[index as usize];
            let mut coming = at_end[jump.from as usize].clone().unwrap_or_default();
            for values in coming.values_mut() {
                values.retain(|&(value, may_be_nil)| !(may_be_nil && jump.shown.iter().any(|&(shown, what)| shown == value && what == NIL)));
            }
            held = Some(match held {
                None => coming,
                Some(mut so_far) => {
                    so_far.retain(|place, _| coming.contains_key(place));
                    for (place, values) in &mut so_far {
                        for &value in &coming[place] {
                            if !values.contains(&value) {
                                values.push(value);
                            }
                        }
                    }
                    so_far
                }
            });
        }
        let mut held = held.unwrap_or_default();
        for event in &events[block] {
            match *event {
                PlaceEvent::Read { place, value } => match held.get(&place) {
                    Some(values) if values.iter().all(|&(_, may_be_nil)| !may_be_nil) => {
                        found.insert(value, values.iter().map(|&(value, _)| value).collect());
                    }
                    _ => {
                        held.insert(place, vec![(value, true)]);
                    }
                },
                PlaceEvent::Store { place, value, may_be_nil } => {
                    held.retain(|&other, _| names[other as usize] != names[place as usize]);
                    held.insert(place, vec![(value, may_be_nil)]);
                }
                PlaceEvent::Anything => held.clear(),
            }
        }
        at_end[block] = Some(held);
        is_done[block] = true;
        for jump in leaving[block].iter().map(|&index| &function.jumps[index as usize]) {
            let next = jump.to as usize;
            if !is_done[next] && arriving[next].iter().all(|&index| is_done[function.jumps[index as usize].from as usize] || loop_of[next] == loop_of[function.jumps[index as usize].from as usize]) {
                pending.push(next as u32);
            }
        }
    }
    found
}

fn loops_of(function: &NilFlowsInFunction, leaving: &[Vec<u32>]) -> Vec<u32> {
    const NONE: u32 = u32::MAX;
    let blocks = leaving.len();
    let (mut number, mut lowest, mut loop_of) = (vec![NONE; blocks], vec![NONE; blocks], vec![NONE; blocks]);
    let (mut open, mut path): (Vec<u32>, Vec<(u32, usize)>) = (Vec::new(), Vec::new());
    let (mut numbers, mut loops) = (0, 0);
    for start in 0..blocks as u32 {
        if number[start as usize] != NONE {
            continue;
        }
        path.push((start, 0));
        while let Some(top) = path.last_mut() {
            let (block, here) = (top.0, top.0 as usize);
            if number[here] == NONE {
                (number[here], lowest[here]) = (numbers, numbers);
                numbers += 1;
                open.push(block);
            }
            if let Some(&index) = leaving[here].get(top.1) {
                top.1 += 1;
                let to = function.jumps[index as usize].to;
                if number[to as usize] == NONE {
                    path.push((to, 0));
                } else if loop_of[to as usize] == NONE {
                    lowest[here] = lowest[here].min(number[to as usize]);
                }
                continue;
            }
            path.pop();
            if let Some(above) = path.last() {
                lowest[above.0 as usize] = lowest[above.0 as usize].min(lowest[here]);
            }
            if lowest[here] == number[here] {
                while let Some(member) = open.pop() {
                    loop_of[member as usize] = loops;
                    if member == block {
                        break;
                    }
                }
                loops += 1;
            }
        }
    }
    loop_of
}

/// By node: what may get there.
/// A method of the engine's that calls a function it is handed: the parameters of the function, by number, that it hands what a container holds: `list.map((element, index) => ..)`. Of that
/// nothing is known; an index, the container itself and what the function has returned before are what they are. `is_array`: the receiver is one for sure: else `forEach` may be a `Map`'s, which
/// hands over a key as well.
pub fn parameters_handed_elements(method: &[u8], is_array: bool) -> &'static [usize] {
    match method {
        b"forEach" if !is_array => &[0, 1],
        b"forEach" | b"map" | b"filter" | b"find" | b"findIndex" | b"findLast" | b"findLastIndex" | b"some" | b"every" | b"flatMap" | b"from" | b"fromAsync" | b"then" | b"groupBy" => &[0],
        b"sort" | b"toSorted" => &[0, 1],
        // The first is what the function has returned, or an element where no value to start with is given.
        b"reduce" | b"reduceRight" => &[0, 1],
        _ => &[],
    }
}

pub fn add_nil_flows_in(function: &NilFlowsInFunction, found: &mut NilEdges, room: &mut RoomForFlows) {
    let NilEdges { edges, origins } = found;
    add_edges_in(function, edges, &mut |node, nil| origins.push((node, nil)), room);
}

#[derive(Default)]
struct ListsByBlock {
    first: Vec<u32>,
    next: Vec<u32>,
    items: Vec<u32>,
}

impl ListsByBlock {
    fn lay(&mut self, blocks: usize, pairs: impl Iterator<Item = (u32, u32)> + Clone) {
        self.first.clear();
        self.first.resize(blocks + 1, 0);
        for (block, _) in pairs.clone() {
            self.first[block as usize + 1] += 1;
        }
        for block in 0..blocks {
            self.first[block + 1] += self.first[block];
        }
        self.next.clear();
        self.next.extend_from_slice(&self.first[..blocks]);
        self.items.clear();
        self.items.resize(self.first[blocks] as usize, 0);
        for (block, item) in pairs {
            self.items[self.next[block as usize] as usize] = item;
            self.next[block as usize] += 1;
        }
    }

    fn of(&self, block: usize) -> &[u32] {
        &self.items[self.first[block] as usize..self.first[block + 1] as usize]
    }
}

#[derive(Default)]
pub struct RoomForFlows {
    following: ListsByBlock,
    preceding: ListsByBlock,
    dominated: ListsByBlock,
    uses_in: ListsByBlock,
    origins_in: ListsByBlock,
    only_jump: Vec<u32>,
    jumps_to: Vec<u32>,
    order: Vec<u32>,
    is_seen: Vec<bool>,
    stack: Vec<(u32, usize)>,
    number: Vec<u32>,
    dominator: Vec<u32>,
    climbed_for: Vec<u32>,
    shown: FxHashMap<u32, u8>,
    taken_back: Vec<(u32, u8)>,
    walk: Vec<(u32, usize, usize)>,
    is_entered: Vec<bool>,
}

fn filled<T: Copy>(list: &mut Vec<T>, length: usize, with: T) {
    list.clear();
    list.resize(length, with);
}

pub struct EdgesByNode {
    first: Vec<u32>,
    pub other: Vec<u32>,
    pub nil: Vec<u8>,
}

impl EdgesByNode {
    pub fn at(&self, node: u32) -> std::ops::Range<usize> {
        self.first[node as usize] as usize..self.first[node as usize + 1] as usize
    }
}

pub fn edges_by_node(nodes: u32, runs: &[u32], parts: &[&[(u32, u32, u8)]], pick: impl Fn(&(u32, u32, u8)) -> Option<(u32, u32)> + Sync, in_parallel: InParallel<'_>) -> EdgesByNode {
    const NODES_OF_A_BLOCK: u32 = 1 << 12;
    let end_of = |run: usize| runs.get(run + 1).copied().unwrap_or(nodes);
    let mut split: Vec<(usize, usize, Vec<(u32, u32, u8)>)> = (0..parts.len()).map(|part| (part, 0, Vec::new())).collect();
    for_each_mut(&mut split, in_parallel, &|(part, own, strays)| {
        let (low, high) = if *part < runs.len() { (runs[*part], end_of(*part)) } else { (0, 0) };
        for edge in parts[*part] {
            let Some((node, other)) = pick(edge) else { continue };
            if low <= node && node < high {
                *own += 1;
            } else {
                strays.push((node, other, edge.2));
            }
        }
    });
    let mut run = 0;
    let run_of_block: Vec<u32> = (0..=nodes / NODES_OF_A_BLOCK)
        .map(|block| {
            while end_of(run) <= block * NODES_OF_A_BLOCK && run + 1 < runs.len() {
                run += 1;
            }
            run as u32
        })
        .collect();
    let mut handed: Vec<Vec<(u32, u32, u8)>> = vec![Vec::new(); runs.len()];
    for stray in split.iter().flat_map(|part| &part.2) {
        let mut run = run_of_block[(stray.0 / NODES_OF_A_BLOCK) as usize] as usize;
        while end_of(run) <= stray.0 {
            run += 1;
        }
        handed[run].push(*stray);
    }
    let many: Vec<usize> = handed.iter().enumerate().map(|(run, handed)| handed.len() + split.get(run).map_or(0, |part| part.1)).collect();
    let all: usize = many.iter().sum();
    let (mut first, mut other, mut nil) = (vec![0u32; nodes as usize + 1], vec![0u32; all], vec![0u8; all]);
    first[nodes as usize] = all as u32;
    struct Run<'a> {
        number: usize,
        ahead: u32,
        first: &'a mut [u32],
        other: &'a mut [u32],
        nil: &'a mut [u8],
    }
    let (mut first_left, mut other_left, mut nullish_left, mut ahead) = (&mut first[..nodes as usize], &mut other[..], &mut nil[..], 0);
    let mut tasks: Vec<Run<'_>> = Vec::with_capacity(runs.len());
    for (number, &many) in many.iter().enumerate() {
        let (first, left) = first_left.split_at_mut((end_of(number) - runs[number]) as usize);
        first_left = left;
        let (other, left) = other_left.split_at_mut(many);
        other_left = left;
        let (nil, left) = nullish_left.split_at_mut(many);
        nullish_left = left;
        tasks.push(Run { number, ahead, first, other, nil });
        ahead += many as u32;
    }
    for_each_mut(&mut tasks, in_parallel, &|Run { number, ahead, first, other, nil }| {
        let (low, high) = (runs[*number], end_of(*number));
        let own = parts.get(*number).copied().unwrap_or_default();
        let edges = || own.iter().filter_map(|edge| pick(edge).filter(|picked| low <= picked.0 && picked.0 < high).map(|picked| (picked.0, picked.1, edge.2))).chain(handed[*number].iter().copied());
        for edge in edges() {
            first[(edge.0 - low) as usize] += 1;
        }
        let mut sum = 0;
        for slot in first.iter_mut() {
            sum += std::mem::replace(slot, sum);
        }
        for edge in edges() {
            let at = &mut first[(edge.0 - low) as usize];
            other[*at as usize] = edge.1;
            nil[*at as usize] = edge.2;
            *at += 1;
        }
        let mut begins = *ahead;
        for slot in first.iter_mut() {
            begins = std::mem::replace(slot, begins) + *ahead;
        }
    });
    EdgesByNode { first, other, nil }
}

const EDGE_WALK_TASKS: usize = 64;

fn split_into_tasks(pending: Vec<u32>) -> Vec<Vec<u32>> {
    pending.chunks(pending.len().div_ceil(EDGE_WALK_TASKS).max(1)).map(<[u32]>::to_vec).collect()
}

pub fn reach_backward(entering: &EdgesByNode, is_reached: Vec<bool>, pending: Vec<u32>, in_parallel: InParallel<'_>) -> Vec<bool> {
    use std::sync::atomic::{AtomicBool, Ordering};
    let is_reached: Vec<AtomicBool> = is_reached.into_iter().map(AtomicBool::new).collect();
    for_each_mut(&mut split_into_tasks(pending), in_parallel, &|pending| {
        while let Some(node) = pending.pop() {
            for &from in &entering.other[entering.at(node)] {
                if !is_reached[from as usize].load(Ordering::Relaxed) && !is_reached[from as usize].swap(true, Ordering::Relaxed) {
                    pending.push(from);
                }
            }
        }
    });
    is_reached.into_iter().map(AtomicBool::into_inner).collect()
}

pub fn nil_reaching(leaving: &EdgesByNode, more: &[(u32, u32, u8)], origins: impl Iterator<Item = (u32, u8)>, is_cut: impl Fn(u32, u32) -> bool + Sync, in_parallel: InParallel<'_>) -> Vec<u8> {
    use std::sync::atomic::{AtomicU8, Ordering};
    let mut reaching = vec![0u8; leaving.first.len() - 1];
    let mut pending: Vec<u32> = Vec::new();
    for (node, nil) in origins {
        if reaching[node as usize] | nil != reaching[node as usize] {
            reaching[node as usize] |= nil;
            pending.push(node);
        }
    }
    let mut leaving_too: FxHashMap<u32, smallvec::SmallVec<[(u32, u8); 2]>> = FxHashMap::default();
    for &(from, to, nil) in more {
        leaving_too.entry(from).or_default().push((to, nil));
    }
    let reaching: Vec<AtomicU8> = reaching.into_iter().map(AtomicU8::new).collect();
    for_each_mut(&mut split_into_tasks(pending), in_parallel, &|pending| {
        while let Some(node) = pending.pop() {
            let here = reaching[node as usize].load(Ordering::Relaxed);
            let at = leaving.at(node);
            let known = leaving.other[at.clone()].iter().copied().zip(leaving.nil[at].iter().copied()).filter(|edge| !is_cut(node, edge.0));
            for (to, nil) in known.chain(leaving_too.get(&node).into_iter().flatten().copied()) {
                let (brought, there) = (here & nil, reaching[to as usize].load(Ordering::Relaxed));
                if there | brought != there {
                    reaching[to as usize].fetch_or(brought, Ordering::Relaxed);
                    pending.push(to);
                }
            }
        }
    });
    reaching.into_iter().map(AtomicU8::into_inner).collect()
}

/// The uses of the function as edges, each with what no test stops, and its origins.
fn add_edges_in(function: &NilFlowsInFunction, edges: &mut Vec<(u32, u32, u8)>, originate: &mut impl FnMut(u32, u8), room: &mut RoomForFlows) {
    const NIL: u8 = UNDEFINED | NULL;
    const NONE: u32 = u32::MAX;
    let blocks = function.blocks as usize;
    if blocks == 0 {
        return;
    }
    if blocks == 1 && function.jumps.is_empty() {
        for origin in &function.origins {
            originate(origin.node, origin.nil);
        }
        edges.extend(function.uses.iter().map(|used| (used.from, used.to, NIL | STRANGER)));
        return;
    }
    let RoomForFlows { following, preceding, dominated, uses_in, origins_in, only_jump, jumps_to, order, is_seen, stack, number, dominator, climbed_for, shown, taken_back, walk, is_entered } = room;
    following.lay(blocks, function.jumps.iter().map(|jump| (jump.from, jump.to)));
    preceding.lay(blocks, function.jumps.iter().map(|jump| (jump.to, jump.from)));
    // The one jump that leads to the block. `NONE`: there is none, or there are more.
    filled(only_jump, blocks, NONE);
    filled(jumps_to, blocks, 0);
    for (index, jump) in function.jumps.iter().enumerate() {
        jumps_to[jump.to as usize] += 1;
        only_jump[jump.to as usize] = if jumps_to[jump.to as usize] == 1 { index as u32 } else { NONE };
    }
    // Reverse postorder.
    order.clear();
    filled(is_seen, blocks, false);
    stack.clear();
    stack.push((0, 0));
    is_seen[0] = true;
    while let Some(top) = stack.last_mut() {
        let block = top.0;
        match following.of(block as usize).get(top.1) {
            Some(&next) => {
                top.1 += 1;
                if !std::mem::replace(&mut is_seen[next as usize], true) {
                    stack.push((next, 0));
                }
            }
            None => {
                order.push(block);
                stack.pop();
            }
        }
    }
    order.reverse();
    filled(number, blocks, NONE);
    for (index, &block) in order.iter().enumerate() {
        number[block as usize] = index as u32;
    }
    // The immediate dominators (Cooper, Harvey, Kennedy).
    filled(dominator, blocks, NONE);
    dominator[0] = 0;
    filled(climbed_for, blocks, 0);
    let mut findings = 0u32;
    loop {
        let mut has_changed = false;
        for &block in order.iter().skip(1) {
            let mut found = NONE;
            findings += 1;
            for &before in preceding.of(block as usize) {
                if dominator[before as usize] == NONE {
                    continue;
                }
                if found == NONE {
                    found = before;
                    continue;
                }
                let (mut a, mut b) = (before, found);
                while a != b {
                    while number[a as usize] > number[b as usize] {
                        if std::mem::replace(&mut climbed_for[a as usize], findings) == findings {
                            a = b;
                            break;
                        }
                        a = dominator[a as usize];
                    }
                    while number[b as usize] > number[a as usize] {
                        b = dominator[b as usize];
                    }
                }
                found = a;
            }
            if dominator[block as usize] != found {
                dominator[block as usize] = found;
                has_changed = true;
            }
        }
        if !has_changed {
            break;
        }
    }
    dominated.lay(blocks, order.iter().skip(1).map(|&block| (dominator[block as usize], block)));
    uses_in.lay(blocks, function.uses.iter().enumerate().map(|(index, used)| (used.block, index as u32)));
    origins_in.lay(blocks, function.origins.iter().enumerate().map(|(index, origin)| (origin.block, index as u32)));
    // Down the tree of dominators, with what is shown on the way, which is taken back on the way up.
    shown.clear();
    taken_back.clear();
    // A block, which of those it dominates comes next, and how much there was to take back when it was entered.
    walk.clear();
    walk.push((0, 0, 0));
    filled(is_entered, blocks, false);
    while let Some(top) = walk.last_mut() {
        let block = top.0 as usize;
        if !std::mem::replace(&mut is_entered[block], true) {
            if only_jump[block] != NONE {
                for &(value, what) in &function.jumps[only_jump[block] as usize].shown {
                    let known = shown.entry(value).or_insert(0);
                    taken_back.push((value, *known));
                    *known |= what;
                }
            }
            for &index in origins_in.of(block) {
                let origin = &function.origins[index as usize];
                if !origin.unless.iter().any(|&(value, what)| shown.get(&value).is_some_and(|&known| known & what == what)) {
                    originate(origin.node, origin.nil);
                }
            }
            for &index in uses_in.of(block) {
                let used = &function.uses[index as usize];
                let mut stopped = shown.get(&used.value).copied().unwrap_or(0);
                if used.jump != NO_JUMP {
                    stopped |= function.jumps[used.jump as usize].shown.iter().filter(|it| it.0 == used.value).fold(0, |all, it| all | it.1);
                }
                edges.push((used.from, used.to, (NIL | STRANGER) & !stopped));
            }
        }
        match dominated.of(block).get(top.1) {
            Some(&next) => {
                top.1 += 1;
                let mark = taken_back.len();
                walk.push((next, 0, mark));
            }
            None => {
                let mark = top.2;
                for (value, known) in taken_back.drain(mark..).rev() {
                    shown.insert(value, known);
                }
                walk.pop();
            }
        }
    }
}
