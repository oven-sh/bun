//! Object literals: which receivers hold objects of one row, and which stores are the first to their property.

use super::nil::{strip_casts, targets_of};
use crate::id::{FuncId, StrId, V};
use crate::ir::{Func, Op, Operation, Program, Term, func_flags};

pub(super) fn find_single_structure_receivers(program: &Program, in_parallel: bun_sema::util::InParallel<'_>) -> (Vec<(FuncId, V)>, Vec<String>) {
    struct Receiver {
        func: u32,
        accesses: Vec<(V, bool, StrId)>,
        made: u32,
    }
    const NO_STRUCTURE: u32 = u32::MAX;
    const FUNCTIONS_PER_TASK: usize = 256;
    const RECEIVERS_PER_TASK: usize = 1024;
    #[derive(Default)]
    struct Found {
        rows: Vec<Vec<StrId>>,
        structure_ids: rustc_hash::FxHashMap<Vec<StrId>, u32>,
        receivers: Vec<Receiver>,
        functions: usize,
    }
    let mut tasks: Vec<(usize, &[Func], Found)> = program.funcs.chunks(FUNCTIONS_PER_TASK).enumerate().map(|(number, funcs)| (number * FUNCTIONS_PER_TASK, funcs, Found::default())).collect();
    bun_sema::util::for_each_mut(&mut tasks, in_parallel, &|(first_function, funcs, found)| {
        let Found { rows, structure_ids, receivers, functions } = found;
        for (index, func) in funcs.iter().enumerate() {
            if func.has(func_flags::IS_TYPED | func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) {
                continue;
            }
            *functions += 1;
            let this = match func.blocks.first() {
                Some(entry) if func.has(func_flags::HAS_THIS) && entry.params.len() > func.params.len() => entry.params[func.captures.len().min(entry.params.len() - func.params.len() - 1)],
                _ => V::NONE,
            };
            let mut literals: Vec<(V, Option<Vec<StrId>>)> = Vec::new();
            let first = receivers.len();
            let mut place_of: rustc_hash::FxHashMap<V, usize> = Default::default();
            for block in &func.blocks {
                for &v in &block.ops {
                    let (obj, is_store, name) = match func.op(v) {
                        Some(Op::NewObject) => {
                            literals.push((v, Some(Vec::new())));
                            continue;
                        }
                        Some(Op::Operation { which, args }) => {
                            let Some(&made) = args.first() else { continue };
                            let made = strip_casts(func, made);
                            let is_definition = *which == Operation::DefineField && args.len() == 3;
                            if !is_definition && !matches!(which, Operation::CopyDataProperties | Operation::CopyDataPropertiesExcluding) {
                                continue;
                            }
                            if let Some(literal) = literals.iter_mut().find(|literal| literal.0 == made) {
                                let key = match is_definition.then(|| func.op(strip_casts(func, args[1]))).flatten() {
                                    Some(&Op::Str(key)) => Some(key),
                                    _ => None,
                                };
                                match key {
                                    Some(key) => {
                                        if let Some(row) = &mut literal.1
                                            && !row.contains(&key)
                                        {
                                            row.push(key);
                                        }
                                    }
                                    None => literal.1 = None,
                                }
                            }
                            continue;
                        }
                        Some(&Op::PropGet { obj, name }) => (obj, false, name),
                        Some(&Op::PropSet { obj, name, .. }) => (obj, true, name),
                        _ => continue,
                    };
                    let place = *place_of.entry(strip_casts(func, obj)).or_insert_with(|| {
                        receivers.push(Receiver { func: (*first_function + index) as u32, accesses: Vec::new(), made: NO_STRUCTURE });
                        receivers.len() - 1
                    });
                    receivers[place].accesses.push((v, is_store, name));
                }
            }
            let mut number = |row: Vec<StrId>| {
                let next = rows.len() as u32;
                *structure_ids.entry(row.clone()).or_insert_with(|| {
                    rows.push(row);
                    next
                })
            };
            for (_, row) in literals {
                if let Some(row) = row.filter(|row| !row.is_empty()) {
                    number(row);
                }
            }
            if let Some(&place) = place_of.get(&this).filter(|_| this.is_some()) {
                debug_assert!(place >= first);
                let mut made: Vec<StrId> = Vec::new();
                for &(_, is_store, name) in &receivers[place].accesses {
                    if is_store && !made.contains(&name) {
                        made.push(name);
                    }
                }
                if !made.is_empty() {
                    receivers[place].made = number(made);
                }
            }
        }
    });
    let mut rows: Vec<Vec<StrId>> = Vec::new();
    let mut structure_ids: rustc_hash::FxHashMap<Vec<StrId>, u32> = Default::default();
    let mut receivers: Vec<Receiver> = Vec::new();
    let mut functions = 0usize;
    for (_, _, found) in tasks {
        let numbers: Vec<u32> = (found.rows.into_iter())
            .map(|row| {
                let next = rows.len() as u32;
                *structure_ids.entry(row.clone()).or_insert_with(|| {
                    rows.push(row);
                    next
                })
            })
            .collect();
        receivers.extend(found.receivers.into_iter().map(|receiver| Receiver { made: if receiver.made == NO_STRUCTURE { NO_STRUCTURE } else { numbers[receiver.made as usize] }, ..receiver }));
        functions += found.functions;
    }
    let mut having: rustc_hash::FxHashMap<StrId, Vec<u32>> = Default::default();
    for (number, row) in rows.iter().enumerate() {
        for &name in row {
            having.entry(name).or_default().push(number as u32);
        }
    }
    let names_of = |receiver: &Receiver| {
        let mut names: Vec<StrId> = Vec::new();
        for &(_, _, name) in &receiver.accesses {
            if !names.contains(&name) {
                names.push(name);
            }
        }
        names
    };
    let structures_with_all = |names: &[StrId]| -> Vec<u32> {
        let Some(fewest) = names.iter().map(|name| having.get(name).map_or(&[][..], |list| &list[..])).min_by_key(|list| list.len()) else { return Vec::new() };
        fewest.iter().copied().filter(|&row| names.iter().all(|name| rows[row as usize].contains(name))).collect()
    };
    let mut tasks: Vec<(&[Receiver], Vec<bool>)> = receivers.chunks(RECEIVERS_PER_TASK).map(|receivers| (receivers, Vec::new())).collect();
    bun_sema::util::for_each_mut(&mut tasks, in_parallel, &|(receivers, is_grown)| {
        is_grown.resize(rows.len(), false);
        for receiver in receivers.iter() {
            if !receiver.accesses.iter().any(|access| access.1) {
                continue;
            }
            let names = names_of(receiver);
            if !structures_with_all(&names).is_empty() {
                continue;
            }
            for name in &names {
                for &row in having.get(name).map_or(&[][..], |list| &list[..]) {
                    if row == receiver.made || is_grown[row as usize] {
                        continue;
                    }
                    let structure_fields = &rows[row as usize];
                    let is_extra = |name: StrId| !structure_fields.contains(&name) && receiver.accesses.iter().any(|access| access.1 && access.2 == name);
                    if names.iter().any(|&name| is_extra(name)) && names.iter().all(|&name| structure_fields.contains(&name) || is_extra(name)) {
                        let shared: Vec<StrId> = names.iter().copied().filter(|&name| structure_fields.contains(&name)).collect();
                        if structures_with_all(&shared).len() <= 3 {
                            is_grown[row as usize] = true;
                        }
                    }
                }
            }
        }
    });
    let mut is_grown = vec![false; rows.len()];
    for (_, grown) in tasks {
        for (all, here) in is_grown.iter_mut().zip(grown) {
            *all |= here;
        }
    }
    let mut tasks: Vec<(&[Receiver], [[usize; 2]; 4], Vec<(FuncId, V)>)> = receivers.chunks(RECEIVERS_PER_TASK).map(|receivers| (receivers, [[0usize; 2]; 4], Vec::new())).collect();
    bun_sema::util::for_each_mut(&mut tasks, in_parallel, &|(receivers, counted, labelled)| {
        for receiver in receivers.iter() {
            let found = structures_with_all(&names_of(receiver));
            let class = match found[..] {
                [] => 3,
                [row] if is_grown[row as usize] => 1,
                [_] => 0,
                _ => 2,
            };
            counted[class][0] += 1;
            counted[class][1] += receiver.accesses.len();
            if class == 0 {
                labelled.extend(receiver.accesses.iter().map(|access| (FuncId(receiver.func), access.0)));
            }
        }
    });
    let mut counted = [[0usize; 2]; 4];
    let mut labelled: Vec<(FuncId, V)> = Vec::new();
    for (_, counted_here, mut labeled_here) in tasks {
        for (class, here) in counted_here.into_iter().enumerate() {
            counted[class][0] += here[0];
            counted[class][1] += here[1];
        }
        labelled.append(&mut labeled_here);
    }
    labelled.sort_unstable();
    let mut lines = vec![format!("rows: untyped functions {functions}; rows born in the text {} (grown by the text: {}); receivers {}", rows.len(), is_grown.iter().filter(|&&grown| grown).count(), receivers.len())];
    for (class, what) in ["LABELLED: one row, not grown", "one row, GROWN in the text", "several rows have the names", "no birth in the text has the names"].iter().enumerate() {
        lines.push(format!("rows: {:>7} receivers, {:>8} accesses: {what}", counted[class][0], counted[class][1]));
    }
    (labelled, lines)
}

struct BlockOrder {
    is_reached: Vec<bool>,
    entered: Vec<u32>,
    last_descendant: Vec<u32>,
    component: Vec<u32>,
    is_cyclic: Vec<bool>,
    successors: Vec<Vec<usize>>,
}

struct LiteralFlow<'a> {
    func: &'a Func,
    order: std::cell::OnceCell<BlockOrder>,
    uses: rustc_hash::FxHashMap<V, Vec<usize>>,
    places: rustc_hash::FxHashMap<V, Vec<(u32, u32)>>,
    halts: Vec<Vec<u32>>,
}

impl BlockOrder {
    fn of(func: &Func) -> BlockOrder {
        let count = func.blocks.len();
        let successors: Vec<Vec<usize>> = func.blocks.iter().map(|block| targets_of(block.term.as_ref()).iter().map(|target| target.block.idx()).collect()).collect();
        let mut predecessors: Vec<Vec<usize>> = vec![Vec::new(); count];
        for (number, targets) in successors.iter().enumerate() {
            for &target in targets {
                predecessors[target].push(number);
            }
        }
        const NONE: usize = usize::MAX;
        let mut is_reached = vec![false; count];
        let mut postorder: Vec<usize> = Vec::with_capacity(count);
        let mut calls: Vec<(usize, usize)> = vec![(0, 0)];
        is_reached[0] = true;
        while let Some(top) = calls.last_mut() {
            let (block, next) = *top;
            top.1 += 1;
            match successors[block].get(next) {
                Some(&target) if !std::mem::replace(&mut is_reached[target], true) => calls.push((target, 0)),
                Some(_) => {}
                None => {
                    postorder.push(block);
                    calls.pop();
                }
            }
        }
        let mut rank = vec![0usize; count];
        for (position, &block) in postorder.iter().enumerate() {
            rank[block] = position;
        }
        let mut immediate = vec![NONE; count];
        immediate[0] = 0;
        let mut has_changed = true;
        while has_changed {
            has_changed = false;
            for &block in postorder.iter().rev().skip(1) {
                let mut found = NONE;
                for &predecessor in predecessors[block].iter().filter(|&&predecessor| immediate[predecessor] != NONE) {
                    let (mut a, mut b) = (predecessor, if found == NONE { predecessor } else { found });
                    while a != b {
                        while rank[a] < rank[b] {
                            a = immediate[a];
                        }
                        while rank[b] < rank[a] {
                            b = immediate[b];
                        }
                    }
                    found = a;
                }
                if immediate[block] != found {
                    immediate[block] = found;
                    has_changed = true;
                }
            }
        }
        let mut below: Vec<Vec<usize>> = vec![Vec::new(); count];
        for &block in postorder.iter().rev().skip(1) {
            below[immediate[block]].push(block);
        }
        let (mut entered, mut last_descendant) = (vec![0u32; count], vec![0u32; count]);
        let mut numbered = 0u32;
        calls.push((0, 0));
        while let Some(top) = calls.last_mut() {
            let (block, next) = *top;
            top.1 += 1;
            if next == 0 {
                entered[block] = numbered;
                numbered += 1;
            }
            match below[block].get(next) {
                Some(&child) => calls.push((child, 0)),
                None => {
                    last_descendant[block] = numbered - 1;
                    calls.pop();
                }
            }
        }
        let (mut found_at, mut lowest, mut is_on_path) = (vec![u32::MAX; count], vec![0u32; count], vec![false; count]);
        let (mut component, mut is_cyclic) = (vec![0u32; count], vec![false; count]);
        let (mut found, mut components) = (0u32, 0u32);
        let mut path: Vec<usize> = Vec::new();
        for root in 0..count {
            if found_at[root] != u32::MAX {
                continue;
            }
            calls.push((root, 0));
            while let Some(top) = calls.last_mut() {
                let (block, next) = *top;
                top.1 += 1;
                if next == 0 {
                    (found_at[block], lowest[block]) = (found, found);
                    found += 1;
                    path.push(block);
                    is_on_path[block] = true;
                }
                match successors[block].get(next) {
                    Some(&target) if found_at[target] == u32::MAX => calls.push((target, 0)),
                    Some(&target) => {
                        if is_on_path[target] {
                            lowest[block] = lowest[block].min(found_at[target]);
                        }
                    }
                    None => {
                        calls.pop();
                        if let Some(&(caller, _)) = calls.last() {
                            lowest[caller] = lowest[caller].min(lowest[block]);
                        }
                        if lowest[block] == found_at[block] {
                            let first = path.iter().rposition(|&other| other == block).unwrap_or(0);
                            let is_a_cycle = path.len() - first > 1 || successors[block].contains(&block);
                            for member in path.drain(first..) {
                                is_on_path[member] = false;
                                component[member] = components;
                                is_cyclic[member] = is_a_cycle;
                            }
                            components += 1;
                        }
                    }
                }
            }
        }
        BlockOrder { is_reached, entered, last_descendant, component, is_cyclic, successors }
    }
}

impl<'a> LiteralFlow<'a> {
    fn of(func: &'a Func) -> LiteralFlow<'a> {
        let mut uses: rustc_hash::FxHashMap<V, Vec<usize>> = Default::default();
        let mut places: rustc_hash::FxHashMap<V, Vec<(u32, u32)>> = Default::default();
        let mut halts: Vec<Vec<u32>> = vec![Vec::new(); func.blocks.len()];
        for (number, block) in func.blocks.iter().enumerate() {
            let mut note = |operand: V, at: Option<usize>| {
                if operand.is_none() {
                    return;
                }
                let before = strip_casts(func, operand);
                if matches!(func.op(before), Some(Op::NewObject)) {
                    let known = uses.entry(before).or_default();
                    if known.last() != Some(&number) {
                        known.push(number);
                    }
                    if let Some(at) = at {
                        let known = places.entry(before).or_default();
                        if known.last() != Some(&(number as u32, at as u32)) {
                            known.push((number as u32, at as u32));
                        }
                    }
                }
            };
            for (at, &v) in block.ops.iter().enumerate() {
                if let Some(op) = func.op(v) {
                    if matches!(op, Op::Await(_) | Op::Yield(_)) {
                        halts[number].push(at as u32);
                    }
                    op.for_each_operand(|operand| note(operand, Some(at)));
                }
            }
            if let Some(term) = &block.term {
                term.for_each_operand(|operand| note(operand, None));
                for target in targets_of(Some(term)) {
                    for &argument in target.args.iter() {
                        note(argument, None);
                    }
                }
            }
        }
        LiteralFlow { func, order: std::cell::OnceCell::new(), uses, places, halts }
    }

    fn order(&self) -> &BlockOrder {
        self.order.get_or_init(|| BlockOrder::of(self.func))
    }

    fn dominates(&self, above: usize, below: usize) -> bool {
        let order = self.order();
        !order.is_reached[below] || order.is_reached[above] && order.entered[above] <= order.entered[below] && order.entered[below] <= order.last_descendant[above]
    }

    fn is_in_cycle(&self, block: usize, but_through: usize) -> bool {
        let order = self.order();
        if !order.is_cyclic[block] {
            return false;
        }
        let mut seen = vec![false; order.successors.len()];
        let mut work = order.successors[block].clone();
        while let Some(next) = work.pop() {
            if next == block {
                return true;
            }
            if next != but_through && order.component[next] == order.component[block] && !std::mem::replace(&mut seen[next], true) {
                work.extend_from_slice(&order.successors[next]);
            }
        }
        false
    }
}

#[derive(Default)]
struct LiteralWindow {
    row: Vec<StrId>,
    defined_at_allocation: usize,
    stores: Vec<(V, StrId)>,
    later_defines: Vec<(V, StrId)>,
    ends_at_spread: bool,
}

fn literal_window(func: &Func, flow: &LiteralFlow<'_>, strs: &crate::ir::Strs, it: V, allocated_in: usize, behind: usize) -> LiteralWindow {
    let mut window = LiteralWindow::default();
    let is_it = |operand: V| operand.is_some() && strip_casts(func, operand) == it;
    let no_uses = Vec::new();
    let uses = flow.uses.get(&it).unwrap_or(&no_uses);
    let no_slots = Vec::new();
    let places = flow.places.get(&it).unwrap_or(&no_slots);
    let mut done: Vec<usize> = Vec::new();
    let (mut present, mut from) = (allocated_in, behind);
    loop {
        let block = &func.blocks[present];
        let halt = flow.halts[present].iter().copied().find(|&at| at as usize >= from);
        let first = places.partition_point(|&place| place < (present as u32, from as u32));
        for &(_, at) in places[first..].iter().take_while(|place| place.0 == present as u32) {
            if halt.is_some_and(|halt| halt < at) {
                return window;
            }
            let v = block.ops[at as usize];
            let Some(op) = func.op(v) else { continue };
            let goes_on = match op {
                &Op::Coerce { value, why, .. } => !is_it(value) || why == crate::ir::CoerceReason::Upcast,
                Op::Await(_) | Op::Yield(_) => false,
                Op::Operation { which: Operation::DefineField, args } if args.len() == 3 && is_it(args[0]) => match func.op(strip_casts(func, args[1])) {
                    Some(&Op::Str(key)) if !is_it(args[2]) && window.stores.is_empty() && strs.get(key) != b"__proto__" => {
                        if !window.row.contains(&key) {
                            window.row.push(key);
                        }
                        if present == allocated_in && window.later_defines.is_empty() && !(block.ops.last() == Some(&v) && matches!(block.term, Some(Term::Invoke { .. }))) {
                            window.defined_at_allocation = window.row.len();
                        } else {
                            window.later_defines.push((v, key));
                        }
                        true
                    }
                    _ => false,
                },
                &Op::PropSet { obj, name, value } if is_it(obj) => {
                    let goes_on = !is_it(value) && strs.get(name) != b"__proto__";
                    if goes_on {
                        if !window.row.contains(&name) {
                            window.row.push(name);
                        }
                        window.stores.push((v, name));
                    }
                    goes_on
                }
                &Op::PropGet { obj, name } if is_it(obj) => window.row.contains(&name),
                Op::Operation { which: Operation::CopyDataProperties, args } if args.len() == 2 && is_it(args[0]) && !is_it(args[1]) => {
                    window.ends_at_spread = true;
                    false
                }
                _ => {
                    let mut others = 0usize;
                    op.for_each_operand(|operand| others += usize::from(is_it(operand)));
                    others == 0
                }
            };
            if !goes_on || window.row.len() > 62 {
                return window;
            }
        }
        if halt.is_some() {
            return window;
        }
        let mut is_seen = false;
        if let Some(term) = &block.term {
            term.for_each_operand(|operand| is_seen |= is_it(operand));
            is_seen |= targets_of(Some(term)).iter().any(|target| target.args.iter().any(|&argument| is_it(argument)));
        }
        if is_seen {
            return window;
        }
        done.push(present);
        let later: Vec<usize> = uses.iter().copied().filter(|number| !done.contains(number)).collect();
        let Some(&next) = later.iter().find(|&&next| later.iter().all(|&other| flow.dominates(next, other))) else { return window };
        if !flow.dominates(present, next) || flow.is_in_cycle(next, allocated_in) {
            return window;
        }
        (present, from) = (next, 0);
    }
}

pub(super) fn find_first_stores(program: &mut Program, contents: &[u8], in_parallel: bun_sema::util::InParallel<'_>) {
    const FUNCTIONS_PER_TASK: usize = 256;
    let strs = &program.strs;
    type Found = Vec<(FuncId, V, u32)>;
    let mut tasks: Vec<(usize, &mut [Func], Found)> = program.funcs.chunks_mut(FUNCTIONS_PER_TASK).enumerate().map(|(number, funcs)| (number * FUNCTIONS_PER_TASK, funcs, Found::default())).collect();
    bun_sema::util::for_each_mut(&mut tasks, in_parallel, &|(first, funcs, found)| {
        for (index, func) in funcs.iter_mut().enumerate().filter(|function| contents[*first + function.0] & super::has::OBJECT_LITERALS != 0) {
            let mut births: Vec<(V, usize, usize)> = Vec::new();
            let mut has_late_store = false;
            for (number, block) in func.blocks.iter().enumerate() {
                for (at, &v) in block.ops.iter().enumerate() {
                    match func.op(v) {
                        Some(Op::NewObject) => births.push((v, number, at + 1)),
                        Some(&Op::PropSet { obj, .. }) if !has_late_store => has_late_store = matches!(func.op(strip_casts(func, obj)), Some(Op::NewObject)),
                        Some(Op::Operation { which: Operation::DefineField, args }) if !has_late_store && args.len() == 3 => {
                            let literal = strip_casts(func, args[0]);
                            let ends_in_invoke = block.ops.last() == Some(&v) && matches!(block.term, Some(Term::Invoke { .. }));
                            has_late_store = matches!(func.op(literal), Some(Op::NewObject)) && (ends_in_invoke || births.iter().rev().find(|birth| birth.0 == literal).is_none_or(|birth| birth.1 != number));
                        }
                        _ => {}
                    }
                }
            }
            if !has_late_store {
                continue;
            }
            let flow = LiteralFlow::of(func);
            let mut rewritten: Vec<(V, V, StrId, V)> = Vec::new();
            for (it, allocated_in, behind) in births {
                let window = literal_window(func, &flow, strs, it, allocated_in, behind);
                if window.ends_at_spread || window.row.len() == window.defined_at_allocation || window.row.len() > 62 || window.row.iter().any(|&name| is_index_name(strs.get(name))) {
                    continue;
                }
                for &(define, name) in &window.later_defines {
                    if let Some(Op::Operation { args, .. }) = func.op(define) {
                        rewritten.push((define, args[0], name, args[2]));
                    }
                }
                let mut is_stored = vec![false; window.row.len()];
                for (store, name) in window.later_defines.into_iter().chain(window.stores) {
                    if let Some(place) = window.row.iter().position(|&other| other == name).filter(|&place| place >= window.defined_at_allocation) {
                        let is_first = !std::mem::replace(&mut is_stored[place], true);
                        found.push((FuncId::new(*first + index), store, 1 << 30 | u32::from(is_first) << 9 | 1 << 8 | place as u32));
                    }
                }
            }
            for (define, obj, name, value) in rewritten {
                func.values[define.idx()].def = crate::ir::Def::Op(Op::PropSet { obj, name, value });
            }
        }
        found.sort_unstable();
    });
    let found: Vec<(FuncId, V, u32)> = tasks.into_iter().flat_map(|task| task.2).collect();
    program.known_slots.extend(found);
    program.known_slots.sort_unstable();
}

fn is_index_name(name: &[u8]) -> bool {
    !name.is_empty() && name.len() <= 10 && name.iter().all(u8::is_ascii_digit) && (name == b"0" || name[0] != b'0') && std::str::from_utf8(name).ok().and_then(|text| text.parse::<u64>().ok()).is_some_and(|number| number < u32::MAX as u64)
}
