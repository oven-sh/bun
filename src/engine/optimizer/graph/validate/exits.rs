//! There is a way back to a lower tier wherever one may be needed.

use core::ops::Range;

use bun_engine_asm::abi;
use bun_engine_bytecode::Register;
use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{Boundary, Entity, Op, Origin, State, Table, Value as Ssa};

use super::{Checked, about, exits};
use crate::graph::heaps::is_observable;
use crate::graph::{Format, Graph, Kind, NO_LAYOUT, ON_EDGE};

/// Origins are numbered as instructions are translated. These are the ones that there is no going back to.
#[derive(Clone, Default)]
struct Closed {
    below: u32,
    ranges: Vec<Range<u32>>,
}

impl Closed {
    fn add(&mut self, range: Range<u32>) {
        if range.start == 0 {
            self.below = self.below.max(range.end);
            self.ranges.retain(|it| it.end > range.end);
        } else if let Some(known) = self.ranges.iter_mut().find(|it| it.start == range.start) {
            known.end = known.end.max(range.end);
        } else {
            self.ranges.push(range);
        }
    }

    fn contains(&self, origin: u32) -> bool {
        origin < self.below || self.ranges.iter().any(|it| it.contains(&origin))
    }
}

pub(super) fn validate(graph: &Graph, cfg: &Cfg) -> Checked {
    let function = &graph.function;
    let overwritten = overwritten_arguments(graph, cfg);
    let mut closed_from = Table::filled(function.block_count(), Closed::default());
    for &block in cfg.order() {
        let mut closed = core::mem::take(&mut closed_from[block]);
        let is_backward = |edge| {
            let target = function.target(edge);
            let [from, to] =
                [function.last(block), function.first(target)].map(|it| function.origin(it));
            cfg.is_backward(function, edge) || comes_earlier(graph, to, from)
        };
        let goes_back = function.successors(block).any(is_backward);
        let has_effect = |&value: &Ssa| !closed_by(graph, cfg, value).is_empty();
        let last_effect = function.instructions_backward(block).find(has_effect);
        let mut is_past_effects = last_effect.is_none();
        for value in function.instructions(block) {
            if starts_earlier_code(graph, value) {
                closed = Closed::default();
            }
            let checked = check_state(graph, value).and_then(|()| {
                if exits(graph, value) {
                    check_restores(graph, function.state_of(value), &overwritten)?;
                }
                let resume = resume_of(graph, value).filter(|_| exits(graph, value));
                // From the end of a turn, the head of the loop is ahead.
                let is_ahead =
                    |resume| goes_back && is_past_effects && resume == function.origin(value).0;
                match resume {
                    Some(resume) if closed.contains(resume) && !is_ahead(resume) => {
                        Err(format!("goes back to {resume}, past an effect"))
                    }
                    _ => Ok(()),
                }
            });
            about(graph, value, checked)?;
            if has_effect(&value) {
                closed.add(closed_by(graph, cfg, value));
            }
            is_past_effects |= Some(value) == last_effect;
        }
        for edge in function.successors(block) {
            if !is_backward(edge) {
                let there = &mut closed_from[function.target(edge)];
                there.add(0..closed.below);
                closed.ranges.iter().for_each(|it| there.add(it.clone()));
            }
        }
    }
    check_cycles(graph, cfg)
}

/// What is inlined counts as the call.
fn comes_earlier(graph: &Graph, mut origin: Origin, mut other: Origin) -> bool {
    let frame = |origin| graph.site(origin).position.frame;
    while frame(origin) != frame(other) {
        let is_inner = frame(origin).0 > frame(other).0;
        let inner = if is_inner { &mut origin } else { &mut other };
        *inner = graph.frame_at(*inner).caller;
    }
    origin.0 < other.0
}

/// The head of what was a loop has been joined to the only block that still leads there, with the conversions on the edge.
fn starts_earlier_code(graph: &Graph, value: Ssa) -> bool {
    let (function, origin) = (&graph.function, graph.function.origin(value));
    let following = core::iter::successors(Some(value), |&it| function.next(it).expand());
    let mut alike = following.take_while(|&it| function.origin(it) == origin);
    let previous = function.previous(value).expand();
    previous.is_some_and(|it| comes_earlier(graph, origin, function.origin(it)))
        && alike.any(|it| {
            matches!(
                graph.kind(it),
                Some(Kind::Checkpoint | Kind::InvalidationPoint)
            )
        })
}

/// Without the blocks that poll there are none.
fn check_cycles(graph: &Graph, cfg: &Cfg) -> Checked {
    let function = &graph.function;
    let polls = |block| {
        (function.instructions(block)).any(|value| graph.kind(value) == Some(Kind::PollTraps))
    };
    let mut waiting_for = function.block_table(0);
    let mut ready = Vec::new();
    for &block in cfg.order() {
        if !polls(block) {
            waiting_for[block] = cfg.predecessors(block).len();
        }
        if waiting_for[block] == 0 {
            ready.push(block);
        }
    }
    while let Some(block) = ready.pop() {
        for target in function.successors(block).map(|it| function.target(it)) {
            if waiting_for[target] != 0 {
                waiting_for[target] -= 1;
                if waiting_for[target] == 0 {
                    ready.push(target);
                }
            }
        }
    }
    match cfg.order().iter().find(|&&block| waiting_for[block] != 0) {
        Some(block) => Err(format!(
            "b{} is in or after a cycle that does not poll",
            block.index()
        )),
        None => Ok(()),
    }
}

fn overwritten_arguments(graph: &Graph, cfg: &Cfg) -> Vec<Register> {
    let function = &graph.function;
    let kept = function.entry_params(function.entries()[0]);
    let mut overwritten = Vec::new();
    for value in (cfg.order().iter()).flat_map(|&it| function.instructions(it)) {
        if let Op::Store { args, offset, .. } = *function.op(value)
            && matches!(function.op(args[1]), Op::Pinned(abi::FRAME_POINTER))
            && offset > 0
            && !kept.contains(&Boundary::Frame(offset))
            && !overwritten.contains(&Register::from_offset(offset / 8))
        {
            overwritten.push(Register::from_offset(offset / 8));
        }
    }
    overwritten
}

fn check_restores(graph: &Graph, state: State, overwritten: &[Register]) -> Checked {
    if state.is_none() || overwritten.is_empty() {
        return Ok(());
    }
    let mut layout = &graph.layouts[graph.function.state_layout(state) as usize];
    while layout.caller != NO_LAYOUT {
        layout = &graph.layouts[layout.caller as usize];
    }
    let held = &graph.layout_registers[layout.first_register as usize..];
    let held = &held[..layout.register_count as usize];
    match overwritten.iter().find(|it| !held.contains(it)) {
        Some(missing) => Err(format!("counts on the slot of {missing:?}")),
        None => Ok(()),
    }
}

fn resume_of(graph: &Graph, value: Ssa) -> Option<u32> {
    let state = graph.function.state_of(value).expand()?;
    Some(
        graph.layouts[graph.function.state_layout(state) as usize]
            .resume
            .0,
    )
}

/// From where the instruction would be run a second time, if that must not be.
fn closed_by(graph: &Graph, cfg: &Cfg, value: Ssa) -> Range<u32> {
    let function = &graph.function;
    if !is_observable(function, function.effects(value).writes) {
        return 0..0;
    }
    let object = match (*function.op(value), graph.kind(value)) {
        (Op::Store { args, .. }, _) => Some(graph.object_at(args[1])),
        (_, Some(Kind::SetShape | Kind::GrowSlots)) => Some(graph.root(graph.operand(value, 0))),
        _ => None,
    };
    let made = object.and_then(|it| made_at(graph, cfg, it));
    made.map_or(0, |it| it + 1)..function.origin(value).0 + 1
}

/// The earliest origin, if it depends on the way.
fn made_at(graph: &Graph, cfg: &Cfg, object: Ssa) -> Option<u32> {
    let function = &graph.function;
    let Op::Param(position) = *function.op(object) else {
        let is_new = graph.kind(object).is_some_and(Kind::allocates);
        return is_new.then(|| function.origin(object).0);
    };
    let (mut pending, mut seen, mut earliest) = (vec![(object, position)], Vec::new(), None);
    while let Some((param, position)) = pending.pop() {
        for &edge in cfg.predecessors(function.block_of(param)) {
            let arg = graph.root(function.args(edge)[position as usize]);
            match *function.op(arg) {
                _ if cfg.is_backward(function, edge) => return None,
                Op::Param(_) if cfg.predecessors(function.block_of(arg)).is_empty() => return None,
                Op::Param(_) if seen.contains(&arg) => {}
                Op::Param(position) => {
                    seen.push(arg);
                    pending.push((arg, position));
                }
                _ => earliest = Some(made_at(graph, cfg, arg)?.min(earliest.unwrap_or(u32::MAX))),
            }
        }
    }
    earliest
}

fn check_state(graph: &Graph, value: Ssa) -> Checked {
    let (function, origin) = (&graph.function, graph.function.origin(value));
    let state = function.state_of(value);
    let is_free = matches!(
        graph.node(value),
        Some((
            Kind::AsInt32 | Kind::AsInt52 | Kind::AsDouble | Kind::AsBoolean,
            ON_EDGE
        ))
    );
    if exits(graph, value) && state.is_none() && !is_free {
        return Err("has nowhere to exit to".into());
    }
    if graph.kind(value).is_some_and(Kind::can_throw) {
        let site = graph.site(origin);
        let described = (state.expand())
            .map(|it| graph.site(graph.layouts[function.state_layout(it) as usize].resume));
        let is_right = match described {
            Some(it) if site.has_handler => {
                it.position.frame == site.position.frame && it.own_handler == site.own_handler
            }
            Some(it) => it.position.frame == site.position.frame,
            None => !site.has_handler && site.position.frame.0 == 0,
        };
        if !is_right {
            return Err("cannot be unwound from".into());
        }
    }
    check_values(graph, state)
}

fn check_values(graph: &Graph, state: State) -> Checked {
    if state.is_none() {
        return Ok(());
    }
    let function = &graph.function;
    let values = function.state(state);
    for (&value, &tag) in values.iter().zip(function.state_tags(state)) {
        let format = Format::from_tag(tag);
        if function.type_of(value) != format.machine_type() {
            return Err(format!("has v{} as {format:?}", value.index()));
        }
    }
    Ok(())
}
