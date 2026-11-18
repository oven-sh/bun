//! A state has a value for each register, and describes the objects that have not been made.

use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{State, Value as Ssa};

use super::{Checked, about};
use crate::graph::{Format, Graph, Kind};

pub(super) fn validate(graph: &Graph, cfg: &Cfg) -> Checked {
    let function = &graph.function;
    for value in cfg.order().iter().flat_map(|&it| function.instructions(it)) {
        if let Some(state) = function.state_of(value).expand() {
            let checked = check_descriptions(graph, state);
            let checked = checked.and_then(|()| check_secrecy(graph, value, state));
            about(graph, value, checked)?;
        }
    }
    Ok(())
}

/// Those who walk the stack make no object, so that there is never more than one.
fn check_secrecy(graph: &Graph, value: Ssa, state: State) -> Checked {
    let (values, tags) = (
        graph.function.state(state),
        graph.function.state_tags(state),
    );
    if graph.has_state_for_walks(value) && tags.contains(&(Format::Virtual as u8)) {
        return Err("describes an object to nobody".into());
    }
    let is_missing = |position: usize| {
        tags[position] == Format::Virtual as u8
            || tags[position] == Format::Tagged as u8 && graph.constant(values[position]) == Some(0)
    };
    if graph.kind(value).is_some_and(Kind::shows_stack) && graph.shown_in(state).any(is_missing) {
        return Err("shows what is not there".into());
    }
    Ok(())
}

fn check_descriptions(graph: &Graph, state: State) -> Checked {
    let layouts = graph.layouts_of(state);
    let registers: usize = layouts.map(|it| it.1.register_count as usize).sum();
    let (values, tags) = (
        graph.function.state(state),
        graph.function.state_tags(state),
    );
    let (mut starts, mut next) = (Vec::new(), registers);
    while next < values.len() {
        let number = (graph.constant(values[next])).filter(|_| tags[next] == Format::Tagged as u8);
        let recipe = number.and_then(|it| graph.recipes.get(it as usize));
        starts.push(next as u64);
        next += 1 + recipe
            .ok_or_else(|| format!("has no recipe at {next}"))?
            .word_count();
    }
    if next != values.len() {
        return Err(format!("has {} values for {next}", values.len()));
    }
    let references = (values.iter().zip(tags).enumerate())
        .filter(|(_, (_, tag))| **tag == Format::Virtual as u8)
        .map(|(position, (&value, _))| (position as u64, graph.constant(value)));
    let leads_somewhere = |(_, start): (_, Option<_>)| start.is_some_and(|it| starts.contains(&it));
    let is_announced = |&start: &u64| {
        (references.clone()).any(|(position, to)| position < start && to == Some(start))
    };
    if !references.clone().all(leads_somewhere) || !starts.iter().all(is_announced) {
        return Err("does not refer to what it describes".into());
    }
    Ok(())
}
