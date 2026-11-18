//! Quantifiers, from the tree to the graph.

use super::graph::{Graph, Id, Kind, Span, Traits};
use super::lower::Lowering;
use super::memory::{push, reserve};
use crate::Error;
use crate::program::{ClassId, UNBOUNDED};
use crate::tree::{Node, NodeId};

const STEPS_UNROLLED: u32 = 16;
const CODE_POINTS_UNROLLED: u32 = 4;
const NODES_UNROLLED_AT_ONCE: usize = 32;

fn minus(max: u32, turns: u32) -> u32 {
    match max {
        UNBOUNDED => UNBOUNDED,
        _ => max - turns,
    }
}

#[derive(Clone, Copy)]
struct Quantifier {
    min: u32,
    max: u32,
    greedy: bool,
    is_counted: bool,
}

impl Quantifier {
    fn after(self, turns: u32) -> Quantifier {
        Quantifier {
            min: self.min - turns,
            max: minus(self.max, turns),
            ..self
        }
    }
}

impl Lowering<'_> {
    pub(super) fn repeat(
        &mut self,
        source: NodeId,
        min: u32,
        max: u32,
        greedy: bool,
    ) -> Result<Id, Error> {
        let (closed, size, choices) = (self.groups.closed_so_far(), self.size(), self.choices);
        let body = self.node(source)?;
        let node = self.graph[body];
        if node.max == 0 {
            if min == 0 {
                self.groups.forget(closed);
                return Ok(Graph::EMPTY);
            }
            return Ok(body);
        }
        if min == 0 {
            self.groups.make_optional(closed)?;
        }
        self.choices += usize::from(min != max);
        let is_group = !self.is_one_character(source)
            && !matches!(self.tree[source], Node::BackReference { .. });
        let quantifier = Quantifier {
            min,
            max,
            greedy,
            is_counted: is_group && max > 1 && self.choices != choices,
        };
        let copies = min.saturating_sub(1);
        let cost = (self.size() - size).saturating_mul(copies as usize);
        let is_plain = matches!(node.kind, Kind::Steps(_) | Kind::CodePoint(_));
        let is_affordable = cost <= NODES_UNROLLED_AT_ONCE.min(self.nodes_to_unroll);
        // A copy that fails leaves the captures of the one before it overwritten.
        if is_plain || copies == 0 || !is_affordable || node.is(Traits::REFERENCED) {
            return self.repeat_lowered(body, quantifier);
        }
        self.nodes_to_unroll -= cost;
        let start = self.terms.len();
        let mut last = body;
        for _ in 0..copies {
            let copy = self.single_turn(last, quantifier);
            self.push_term(start, copy)?;
            self.groups.forget(closed);
            last = self.node(source)?;
        }
        let rest = self.repeat_lowered(last, quantifier.after(copies))?;
        self.push_term(start, rest)?;
        self.finish_sequence(start)
    }

    /// Of the graph, in nodes.
    fn size(&self) -> usize {
        self.graph.node_count() + self.graph.steps.len() / STEPS_UNROLLED as usize
    }

    fn single_turn(&mut self, body: Id, quantifier: Quantifier) -> Id {
        let makes_choice = |&it: &Id| {
            let kind = self.graph[it].kind;
            matches!(
                kind,
                Kind::Alternation(_) | Kind::Run { .. } | Kind::Repeat { .. }
            )
        };
        let mut terms = self.graph.terms(&body).iter().copied();
        if let Some(term) = terms.find(makes_choice).filter(|_| quantifier.is_counted) {
            self.graph[term].traits |= Traits::COUNTS_TURN;
        }
        body
    }

    #[inline(never)]
    fn repeat_lowered(&mut self, body: Id, quantifier: Quantifier) -> Result<Id, Error> {
        let (node, Quantifier { min, max, .. }) = (self.graph[body], quantifier);
        match node.kind {
            _ if (min, max) == (1, 1) => Ok(self.single_turn(body, quantifier)),
            Kind::Steps(steps) if steps.len() == 1 => self.repeat_step(steps, quantifier),
            Kind::Steps(steps) if min != 0 && node.min.saturating_mul(min) <= STEPS_UNROLLED => {
                self.repeat_steps(steps, quantifier)
            }
            Kind::CodePoint(class) => self.repeat_code_point(body, class, quantifier),
            _ => self.repeat_group(body, quantifier),
        }
    }

    fn copy_steps(&mut self, steps: Span, copies: u32) -> Result<Id, Error> {
        reserve(&mut self.graph.steps, steps.len() * copies as usize)?;
        let start = self.graph.steps.len();
        for _ in 0..copies {
            self.graph.steps.extend_from_within(steps.range());
        }
        let copied = Span::new(start..self.graph.steps.len());
        self.graph.leaf(Kind::Steps(copied))
    }

    fn repeat_step(&mut self, steps: Span, quantifier: Quantifier) -> Result<Id, Error> {
        let step = self.graph.steps[steps.range().start];
        let required = match quantifier.min {
            0 => Graph::EMPTY,
            1..=STEPS_UNROLLED => self.copy_steps(steps, quantifier.min)?,
            count => {
                let class = self.graph.class_of_step(step)?;
                self.graph.leaf(Kind::StepCount { class, count })?
            }
        };
        if quantifier.min == quantifier.max {
            return Ok(required);
        }
        let class = self.graph.class_of_step(step)?;
        let optional = self.graph.leaf(run(class, false, quantifier))?;
        self.join(&[required, optional])
    }

    fn repeat_steps(&mut self, steps: Span, quantifier: Quantifier) -> Result<Id, Error> {
        let required = self.copy_steps(steps, quantifier.min)?;
        if quantifier.min == quantifier.max {
            return Ok(required);
        }
        let body = self.graph.leaf(Kind::Steps(steps))?;
        let optional = self.repeat_group(body, quantifier.after(quantifier.min))?;
        self.join(&[required, optional])
    }

    fn repeat_code_point(
        &mut self,
        body: Id,
        class: ClassId,
        quantifier: Quantifier,
    ) -> Result<Id, Error> {
        let (start, min) = (self.terms.len(), quantifier.min);
        if min <= CODE_POINTS_UNROLLED {
            for _ in 0..min {
                let copy = self.graph.duplicate(body)?;
                self.push_term(start, copy)?;
            }
        } else {
            let copy = self.graph.duplicate(body)?;
            let required = self.graph.repeat(copy, min, min, true, false)?;
            self.push_term(start, required)?;
        }
        if min != quantifier.max {
            let optional = if quantifier.greedy || quantifier.max == UNBOUNDED {
                let kind = run(class, true, quantifier);
                self.graph.leaf_with_first(kind, self.graph.first(body))?
            } else {
                self.repeat_group(body, quantifier.after(min))?
            };
            self.push_term(start, optional)?;
        }
        self.finish_sequence(start)
    }

    fn repeat_group(&mut self, body: Id, quantifier: Quantifier) -> Result<Id, Error> {
        let Quantifier {
            mut min,
            max,
            greedy,
            is_counted,
        } = quantifier;
        let node = self.graph[body];
        let always_matches = node.min == 0 && node.is(Traits::CANNOT_FAIL);
        if always_matches && greedy && max == UNBOUNDED && node.pairs.is_empty() {
            min = 0;
        }
        let body = if node.min == 0 && min != max {
            let check = self.graph.leaf(Kind::NotEmpty)?;
            let checked = self.append_check(body, check)?;
            self.graph.turn(checked, min != 0)?
        } else {
            body
        };
        if (min, max) != (0, 1) {
            return self.graph.repeat(body, min, max, greedy, is_counted);
        }
        let start = self.terms.len();
        if !greedy {
            push(self.terms, Graph::EMPTY)?;
        }
        self.push_alternative(body)?;
        if greedy {
            push(self.terms, Graph::EMPTY)?;
        }
        let optional = self.finish_alternation(start)?;
        Ok(self.single_turn(optional, quantifier))
    }

    /// Puts `check` at the end of each way through `id` that can be empty.
    fn append_check(&mut self, id: Id, check: Id) -> Result<Id, Error> {
        self.stack.check()?;
        let node = self.graph[id];
        match node.kind {
            _ if node.min != 0 => return Ok(id),
            Kind::Alternation(children) => {
                for index in children.range() {
                    let alternative = self.graph.children[index];
                    let checked = self.append_check(alternative, check)?;
                    self.replace_alternative(index, checked, &[check])?;
                }
            }
            Kind::Sequence(children) => {
                let last = children
                    .range()
                    .rfind(|&index| !self.graph[self.graph.children[index]].is_bookkeeping());
                match last.map(|index| self.graph.children[index]) {
                    Some(last) if matches!(self.graph[last].kind, Kind::Alternation(_)) => {
                        self.append_check(last, check)?;
                    }
                    _ => return self.join(&[id, check]),
                }
            }
            _ => return self.join(&[id, check]),
        }
        self.graph.refresh(id);
        Ok(id)
    }
}

/// Of the characters that are optional.
fn run(class: ClassId, code_points: bool, quantifier: Quantifier) -> Kind {
    Kind::Run {
        class,
        max: minus(quantifier.max, quantifier.min),
        code_points,
        greedy: quantifier.greedy,
        filter: None,
        is_counted: quantifier.is_counted,
    }
}
