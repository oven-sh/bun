use crate::util::{FxHashMap, InParallel, for_each_mut};

pub const UNDEFINED: u8 = 1;
pub const NULL: u8 = 1 << 1;
pub const UNTYPED_OBJECT: u8 = 1 << 2;

pub const NO_JUMP: u32 = u32::MAX;

#[derive(Default)]
pub struct NullishEdges {
    pub edges: Vec<(u32, u32, u8)>,
    pub origins: Vec<(u32, u8)>,
}

#[derive(Default)]
pub struct FunctionNullishFlows {
    pub blocks: u32,
    pub jumps: Vec<Jump>,
    pub origins: Vec<Origin>,
    pub uses: Vec<Use>,
}

pub struct Jump {
    pub from: u32,
    pub to: u32,
    pub shown: Vec<(u32, u8)>,
}

pub struct Origin {
    pub node: u32,
    pub nil: u8,
    pub block: u32,
    pub unless: Vec<(u32, u8)>,
}

pub struct Use {
    pub value: u32,
    pub from: u32,
    pub to: u32,
    pub block: u32,
    pub jump: u32,
}

pub enum SlotEvent {
    Read {
        place: u32,
        value: u32,
    },
    Store {
        place: u32,
        value: u32,
        may_be_nullish: bool,
    },
    Anything,
}

pub fn reaching_stores_for_reads(
    function: &FunctionNullishFlows,
    events: &[Vec<SlotEvent>],
    names: &[u32],
) -> FxHashMap<u32, Vec<u32>> {
    const NULLISH: u8 = UNDEFINED | NULL;
    type SlotValues = FxHashMap<u32, Vec<(u32, bool)>>;
    let blocks = function.blocks as usize;
    let mut found: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    if blocks == 0
        || events.iter().all(|events| {
            !events
                .iter()
                .any(|event| matches!(event, SlotEvent::Read { .. }))
        })
    {
        return found;
    }
    let mut has_event = vec![false; names.len()];
    let place_of = |event: &SlotEvent| match *event {
        SlotEvent::Read { place, .. } | SlotEvent::Store { place, .. } => Some(place),
        SlotEvent::Anything => None,
    };
    if !events
        .iter()
        .flatten()
        .filter_map(place_of)
        .any(|place| std::mem::replace(&mut has_event[place as usize], true))
    {
        return found;
    }
    let (mut arriving, mut leaving): (Vec<Vec<u32>>, Vec<Vec<u32>>) =
        (vec![Vec::new(); blocks], vec![Vec::new(); blocks]);
    for (index, jump) in function.jumps.iter().enumerate() {
        arriving[jump.to as usize].push(index as u32);
        leaving[jump.from as usize].push(index as u32);
    }
    let loop_of = innermost_loops(function, &leaving);
    let mut at_end: Vec<Option<SlotValues>> = vec![None; blocks];
    let mut pending: Vec<u32> = vec![0];
    let mut is_done = vec![false; blocks];
    while let Some(block) = pending.pop() {
        let block = block as usize;
        if is_done[block] {
            continue;
        }
        let mut held: Option<SlotValues> = None;
        for &index in &arriving[block] {
            let jump = &function.jumps[index as usize];
            let mut coming = at_end[jump.from as usize].clone().unwrap_or_default();
            for values in coming.values_mut() {
                values.retain(|&(value, may_be_nullish)| {
                    !(may_be_nullish
                        && jump
                            .shown
                            .iter()
                            .any(|&(shown, what)| shown == value && what == NULLISH))
                });
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
                SlotEvent::Read { place, value } => match held.get(&place) {
                    Some(values) if values.iter().all(|&(_, may_be_nullish)| !may_be_nullish) => {
                        found.insert(value, values.iter().map(|&(value, _)| value).collect());
                    }
                    _ => {
                        held.insert(place, vec![(value, true)]);
                    }
                },
                SlotEvent::Store {
                    place,
                    value,
                    may_be_nullish,
                } => {
                    held.retain(|&other, _| names[other as usize] != names[place as usize]);
                    held.insert(place, vec![(value, may_be_nullish)]);
                }
                SlotEvent::Anything => held.clear(),
            }
        }
        at_end[block] = Some(held);
        is_done[block] = true;
        for jump in leaving[block]
            .iter()
            .map(|&index| &function.jumps[index as usize])
        {
            let next = jump.to as usize;
            if !is_done[next]
                && arriving[next].iter().all(|&index| {
                    is_done[function.jumps[index as usize].from as usize]
                        || loop_of[next] == loop_of[function.jumps[index as usize].from as usize]
                })
            {
                pending.push(next as u32);
            }
        }
    }
    found
}

fn innermost_loops(function: &FunctionNullishFlows, leaving: &[Vec<u32>]) -> Vec<u32> {
    const NONE: u32 = u32::MAX;
    let blocks = leaving.len();
    let (mut number, mut lowest, mut loop_of) =
        (vec![NONE; blocks], vec![NONE; blocks], vec![NONE; blocks]);
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

pub fn callback_element_parameters(method: &[u8], is_array: bool) -> &'static [usize] {
    match method {
        b"forEach" if !is_array => &[0, 1],
        b"forEach" | b"map" | b"filter" | b"find" | b"findIndex" | b"findLast"
        | b"findLastIndex" | b"some" | b"every" | b"flatMap" | b"from" | b"fromAsync" | b"then"
        | b"groupBy" => &[0],
        b"sort" | b"toSorted" => &[0, 1],
        b"reduce" | b"reduceRight" => &[0, 1],
        _ => &[],
    }
}

pub fn add_function_nullish_flows(
    function: &FunctionNullishFlows,
    found: &mut NullishEdges,
    room: &mut FlowScratch,
) {
    let NullishEdges { edges, origins } = found;
    add_function_edges(
        function,
        edges,
        &mut |node, nil| origins.push((node, nil)),
        room,
    );
}

#[derive(Default)]
struct ListsByBlock {
    first: Vec<u32>,
    next: Vec<u32>,
    items: Vec<u32>,
}

impl ListsByBlock {
    fn fill(&mut self, blocks: usize, pairs: impl Iterator<Item = (u32, u32)> + Clone) {
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
pub struct FlowScratch {
    following: ListsByBlock,
    preceding: ListsByBlock,
    dominated: ListsByBlock,
    uses_by_block: ListsByBlock,
    origins_by_block: ListsByBlock,
    single_jump: Vec<u32>,
    jumps_to: Vec<u32>,
    order: Vec<u32>,
    is_seen: Vec<bool>,
    stack: Vec<(u32, usize)>,
    number: Vec<u32>,
    dominator: Vec<u32>,
    visited_for: Vec<u32>,
    shown: FxHashMap<u32, u8>,
    retracted: Vec<(u32, u8)>,
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

pub fn edges_by_node(
    nodes: u32,
    runs: &[u32],
    parts: &[&[(u32, u32, u8)]],
    pick: impl Fn(&(u32, u32, u8)) -> Option<(u32, u32)> + Sync,
    in_parallel: InParallel<'_>,
) -> EdgesByNode {
    const NODES_PER_BLOCK: u32 = 1 << 12;
    let end_of = |run: usize| runs.get(run + 1).copied().unwrap_or(nodes);
    let mut split: Vec<(usize, usize, Vec<(u32, u32, u8)>)> =
        (0..parts.len()).map(|part| (part, 0, Vec::new())).collect();
    for_each_mut(&mut split, in_parallel, &|(part, own, strays)| {
        let (low, high) = if *part < runs.len() {
            (runs[*part], end_of(*part))
        } else {
            (0, 0)
        };
        for edge in parts[*part] {
            let Some((node, other)) = pick(edge) else {
                continue;
            };
            if low <= node && node < high {
                *own += 1;
            } else {
                strays.push((node, other, edge.2));
            }
        }
    });
    let mut run = 0;
    let run_of_block: Vec<u32> = (0..=nodes / NODES_PER_BLOCK)
        .map(|block| {
            while end_of(run) <= block * NODES_PER_BLOCK && run + 1 < runs.len() {
                run += 1;
            }
            run as u32
        })
        .collect();
    let mut handed: Vec<Vec<(u32, u32, u8)>> = vec![Vec::new(); runs.len()];
    for stray in split.iter().flat_map(|part| &part.2) {
        let mut run = run_of_block[(stray.0 / NODES_PER_BLOCK) as usize] as usize;
        while end_of(run) <= stray.0 {
            run += 1;
        }
        handed[run].push(*stray);
    }
    let many: Vec<usize> = handed
        .iter()
        .enumerate()
        .map(|(run, handed)| handed.len() + split.get(run).map_or(0, |part| part.1))
        .collect();
    let all: usize = many.iter().sum();
    let (mut first, mut other, mut nil) = (
        vec![0u32; nodes as usize + 1],
        vec![0u32; all],
        vec![0u8; all],
    );
    first[nodes as usize] = all as u32;
    struct Run<'a> {
        number: usize,
        ahead: u32,
        first: &'a mut [u32],
        other: &'a mut [u32],
        nil: &'a mut [u8],
    }
    let (mut first_left, mut other_left, mut nullish_left, mut ahead) = (
        &mut first[..nodes as usize],
        &mut other[..],
        &mut nil[..],
        0,
    );
    let mut tasks: Vec<Run<'_>> = Vec::with_capacity(runs.len());
    for (number, &many) in many.iter().enumerate() {
        let (first, left) = first_left.split_at_mut((end_of(number) - runs[number]) as usize);
        first_left = left;
        let (other, left) = other_left.split_at_mut(many);
        other_left = left;
        let (nil, left) = nullish_left.split_at_mut(many);
        nullish_left = left;
        tasks.push(Run {
            number,
            ahead,
            first,
            other,
            nil,
        });
        ahead += many as u32;
    }
    for_each_mut(
        &mut tasks,
        in_parallel,
        &|Run {
              number,
              ahead,
              first,
              other,
              nil,
          }| {
            let (low, high) = (runs[*number], end_of(*number));
            let own = parts.get(*number).copied().unwrap_or_default();
            let edges = || {
                own.iter()
                    .filter_map(|edge| {
                        pick(edge)
                            .filter(|picked| low <= picked.0 && picked.0 < high)
                            .map(|picked| (picked.0, picked.1, edge.2))
                    })
                    .chain(handed[*number].iter().copied())
            };
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
        },
    );
    EdgesByNode { first, other, nil }
}

const EDGE_WALK_TASKS: usize = 64;

fn split_into_tasks(pending: Vec<u32>) -> Vec<Vec<u32>> {
    pending
        .chunks(pending.len().div_ceil(EDGE_WALK_TASKS).max(1))
        .map(<[u32]>::to_vec)
        .collect()
}

pub fn reach_backward(
    entering: &EdgesByNode,
    is_reached: Vec<bool>,
    pending: Vec<u32>,
    in_parallel: InParallel<'_>,
) -> Vec<bool> {
    use std::sync::atomic::{AtomicBool, Ordering};
    let is_reached: Vec<AtomicBool> = is_reached.into_iter().map(AtomicBool::new).collect();
    for_each_mut(&mut split_into_tasks(pending), in_parallel, &|pending| {
        while let Some(node) = pending.pop() {
            for &from in &entering.other[entering.at(node)] {
                if !is_reached[from as usize].load(Ordering::Relaxed)
                    && !is_reached[from as usize].swap(true, Ordering::Relaxed)
                {
                    pending.push(from);
                }
            }
        }
    });
    is_reached.into_iter().map(AtomicBool::into_inner).collect()
}

pub fn propagate_nullish(
    leaving: &EdgesByNode,
    more: &[(u32, u32, u8)],
    origins: impl Iterator<Item = (u32, u8)>,
    is_cut: impl Fn(u32, u32) -> bool + Sync,
    in_parallel: InParallel<'_>,
) -> Vec<u8> {
    use std::sync::atomic::{AtomicU8, Ordering};
    let mut reaching = vec![0u8; leaving.first.len() - 1];
    let mut pending: Vec<u32> = Vec::new();
    for (node, nil) in origins {
        if reaching[node as usize] | nil != reaching[node as usize] {
            reaching[node as usize] |= nil;
            pending.push(node);
        }
    }
    let mut also_leaving: FxHashMap<u32, smallvec::SmallVec<[(u32, u8); 2]>> = FxHashMap::default();
    for &(from, to, nil) in more {
        also_leaving.entry(from).or_default().push((to, nil));
    }
    let reaching: Vec<AtomicU8> = reaching.into_iter().map(AtomicU8::new).collect();
    for_each_mut(&mut split_into_tasks(pending), in_parallel, &|pending| {
        while let Some(node) = pending.pop() {
            let here = reaching[node as usize].load(Ordering::Relaxed);
            let at = leaving.at(node);
            let known = leaving.other[at.clone()]
                .iter()
                .copied()
                .zip(leaving.nil[at].iter().copied())
                .filter(|edge| !is_cut(node, edge.0));
            for (to, nil) in known.chain(also_leaving.get(&node).into_iter().flatten().copied()) {
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

fn add_function_edges(
    function: &FunctionNullishFlows,
    edges: &mut Vec<(u32, u32, u8)>,
    originate: &mut impl FnMut(u32, u8),
    room: &mut FlowScratch,
) {
    const NULLISH: u8 = UNDEFINED | NULL;
    const NONE: u32 = u32::MAX;
    let blocks = function.blocks as usize;
    if blocks == 0 {
        return;
    }
    if blocks == 1 && function.jumps.is_empty() {
        for origin in &function.origins {
            originate(origin.node, origin.nil);
        }
        edges.extend(
            function
                .uses
                .iter()
                .map(|used| (used.from, used.to, NULLISH | UNTYPED_OBJECT)),
        );
        return;
    }
    let FlowScratch {
        following,
        preceding,
        dominated,
        uses_by_block,
        origins_by_block,
        single_jump,
        jumps_to,
        order,
        is_seen,
        stack,
        number,
        dominator,
        visited_for,
        shown,
        retracted,
        walk,
        is_entered,
    } = room;
    following.fill(
        blocks,
        function.jumps.iter().map(|jump| (jump.from, jump.to)),
    );
    preceding.fill(
        blocks,
        function.jumps.iter().map(|jump| (jump.to, jump.from)),
    );
    filled(single_jump, blocks, NONE);
    filled(jumps_to, blocks, 0);
    for (index, jump) in function.jumps.iter().enumerate() {
        jumps_to[jump.to as usize] += 1;
        single_jump[jump.to as usize] = if jumps_to[jump.to as usize] == 1 {
            index as u32
        } else {
            NONE
        };
    }
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
    filled(dominator, blocks, NONE);
    dominator[0] = 0;
    filled(visited_for, blocks, 0);
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
                        if std::mem::replace(&mut visited_for[a as usize], findings) == findings {
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
    dominated.fill(
        blocks,
        order
            .iter()
            .skip(1)
            .map(|&block| (dominator[block as usize], block)),
    );
    uses_by_block.fill(
        blocks,
        function
            .uses
            .iter()
            .enumerate()
            .map(|(index, used)| (used.block, index as u32)),
    );
    origins_by_block.fill(
        blocks,
        function
            .origins
            .iter()
            .enumerate()
            .map(|(index, origin)| (origin.block, index as u32)),
    );
    shown.clear();
    retracted.clear();
    walk.clear();
    walk.push((0, 0, 0));
    filled(is_entered, blocks, false);
    while let Some(top) = walk.last_mut() {
        let block = top.0 as usize;
        if !std::mem::replace(&mut is_entered[block], true) {
            if single_jump[block] != NONE {
                for &(value, what) in &function.jumps[single_jump[block] as usize].shown {
                    let known = shown.entry(value).or_insert(0);
                    retracted.push((value, *known));
                    *known |= what;
                }
            }
            for &index in origins_by_block.of(block) {
                let origin = &function.origins[index as usize];
                if !origin.unless.iter().any(|&(value, what)| {
                    shown.get(&value).is_some_and(|&known| known & what == what)
                }) {
                    originate(origin.node, origin.nil);
                }
            }
            for &index in uses_by_block.of(block) {
                let used = &function.uses[index as usize];
                let mut stopped = shown.get(&used.value).copied().unwrap_or(0);
                if used.jump != NO_JUMP {
                    stopped |= function.jumps[used.jump as usize]
                        .shown
                        .iter()
                        .filter(|it| it.0 == used.value)
                        .fold(0, |all, it| all | it.1);
                }
                edges.push((used.from, used.to, (NULLISH | UNTYPED_OBJECT) & !stopped));
            }
        }
        match dominated.of(block).get(top.1) {
            Some(&next) => {
                top.1 += 1;
                let mark = retracted.len();
                walk.push((next, 0, mark));
            }
            None => {
                let mark = top.2;
                for (value, known) in retracted.drain(mark..).rev() {
                    shown.insert(value, known);
                }
                walk.pop();
            }
        }
    }
}
