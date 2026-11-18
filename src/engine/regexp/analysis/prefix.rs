//! The units that a match can start with.

use smallvec::SmallVec;

use super::Next;
use crate::compile::graph::{Graph, Id, Kind, Span, Step, Traits};
use crate::program::Direction;
use crate::surrogate::TRAILS;

pub(crate) const MAX_ROWS: usize = 8;
pub(crate) const MAX_COLUMNS: usize = 16;
const MAX_DEPTH: u32 = 12;
const MAX_VISITS: u32 = 200;

/// What a unit can be.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Cell {
    Step(Step),
    /// An index into the unions of [`Prefixes`].
    Union(u32),
}

/// Some of the ways in which a match can start.
#[derive(Clone, Copy)]
pub(crate) struct Row {
    cells: [Cell; MAX_COLUMNS],
    length: u8,
    /// Whether the cells are all that the pattern has passed so far.
    is_open: bool,
    /// The unit before the match, if there is one.
    pub(crate) before: Option<Cell>,
}

impl Row {
    const EMPTY: Row = Row {
        cells: [Cell::Union(0); MAX_COLUMNS],
        length: 0,
        is_open: true,
        before: None,
    };

    pub(crate) fn cells(&self) -> &[Cell] {
        &self.cells[..usize::from(self.length)]
    }

    fn push(&mut self, cell: Cell) {
        if self.is_open {
            self.cells[usize::from(self.length)] = cell;
            self.length += 1;
            self.is_open = usize::from(self.length) < MAX_COLUMNS;
        }
    }
}

#[derive(Default)]
pub(crate) struct Prefixes {
    /// For the matches that can be anywhere.
    pub(crate) rows: SmallVec<[Row; 4]>,
    unions: SmallVec<[Next; 4]>,
    /// Others can be at the start of the subject.
    pub(crate) some_are_at_start: bool,
    /// Others are at the end of the subject, and this long at most.
    pub(crate) longest_at_end: Option<u32>,
}

impl Prefixes {
    /// There are none yet.
    pub(crate) fn find(&mut self, graph: &Graph, terms: &[Id]) {
        self.rows.push(Row::EMPTY);
        let mut walk = Walk {
            graph,
            found: self,
            visits_left: MAX_VISITS,
        };
        walk.visit_all(terms, 0, 0);
    }

    pub(crate) fn units(&self, graph: &Graph, cell: Cell) -> Next {
        match cell {
            Cell::Step(step) => graph.units_of_step(step),
            Cell::Union(index) => self.unions[index as usize],
        }
    }
}

struct Walk<'a> {
    graph: &'a Graph,
    found: &'a mut Prefixes,
    visits_left: u32,
}

impl Walk<'_> {
    fn add_union(&mut self, units: Next) -> Cell {
        self.found.unions.push(units);
        Cell::Union(self.found.unions.len() as u32 - 1)
    }

    fn push(&mut self, start: usize, cell: Cell) {
        self.found.rows[start..]
            .iter_mut()
            .for_each(|row| row.push(cell));
    }

    fn close(&mut self, start: usize) {
        self.found.rows[start..]
            .iter_mut()
            .for_each(|row| row.is_open = false);
    }

    fn remove_open(&mut self, start: usize) {
        let mut index = 0;
        self.found.rows.retain(|row| {
            index += 1;
            index <= start || !row.is_open
        });
    }

    /// Ends the rows with what the node starts with.
    fn glance(&mut self, id: Id, start: usize) {
        let node = &self.graph[id];
        if node.min != 0 && !node.is(Traits::OPEN) {
            let cell = self.add_union(self.graph.first(id));
            self.push(start, cell);
        }
        self.close(start);
    }

    /// Continues the open rows from `start` on with the node.
    fn visit(&mut self, id: Id, start: usize, depth: u32) {
        if depth == MAX_DEPTH || self.visits_left == 0 {
            return self.glance(id, start);
        }
        self.visits_left -= 1;
        let graph = self.graph;
        match graph[id].kind {
            Kind::Empty
            | Kind::Open(_)
            | Kind::Close(_)
            | Kind::Clear(_)
            | Kind::NotEmpty
            | Kind::Boundary { .. }
            | Kind::Look { .. } => {}
            Kind::Peek { side, step, .. } => {
                let rows = self.found.rows[start..].iter_mut();
                let at_start = rows.filter(|row| row.is_open && row.length == 0);
                if side == Direction::Backward {
                    at_start.for_each(|row| row.before = Some(Cell::Step(step)));
                }
            }
            Kind::Edge(Direction::Backward) => {
                self.found.some_are_at_start = true;
                self.remove_open(start);
            }
            Kind::Edge(Direction::Forward) => {
                let open = self.found.rows[start..].iter().filter(|row| row.is_open);
                let longest = open.map(|row| u32::from(row.length)).max();
                self.found.longest_at_end = self.found.longest_at_end.max(longest);
                self.remove_open(start);
            }
            Kind::Fail => self.remove_open(start),
            Kind::Accept | Kind::BackReference { .. } => self.close(start),
            Kind::Steps(steps) => {
                for &step in graph.steps[steps.range()].iter().take(MAX_COLUMNS) {
                    self.push(start, Cell::Step(step));
                }
            }
            Kind::StepCount { class, count } => {
                for _ in 0..count.min(MAX_COLUMNS as u32) {
                    self.push(start, Cell::Step(Step::Class(class)));
                }
            }
            Kind::Pair(_) => {
                let mut trails = Next::NOTHING;
                trails.insert_wide(TRAILS);
                for units in [graph.first(id), trails] {
                    let cell = self.add_union(units);
                    self.push(start, cell);
                }
            }
            Kind::CodePoint(_) => self.glance(id, start),
            Kind::Sequence(children) => self.visit_all(graph.children_of(children), start, depth),
            Kind::Alternation(children) if children.len() > self.visits_left as usize => {
                self.glance(id, start);
            }
            Kind::Alternation(children) => self.alternation(children, start, depth),
            Kind::Turn(body) => self.visit(body, start, depth + 1),
            Kind::Run {
                class,
                max,
                code_points,
                ..
            } => {
                let taking = self.copy_open(start, self.found.rows.len());
                let cell = match code_points {
                    true => self.add_union(graph.first(id)),
                    false => Cell::Step(Step::Class(class)),
                };
                self.push(taking, cell);
                if max != 1 || code_points {
                    self.close(taking);
                }
                self.reduce(start, 0);
            }
            Kind::Repeat { max: 0, .. } => {}
            Kind::Repeat { body, min, .. } => {
                if min != 0 {
                    self.visit(body, start, depth + 1);
                }
                if min > 1 {
                    return self.glance(body, start);
                }
                let again = self.copy_open(start, self.found.rows.len());
                self.visit(body, again, depth + 1);
                self.close(again);
                self.reduce(start, 0);
            }
        }
    }

    fn visit_all(&mut self, terms: &[Id], start: usize, depth: u32) {
        for &term in terms {
            if !self.found.rows[start..].iter().any(|row| row.is_open) {
                break;
            }
            self.visit(term, start, depth + 1);
        }
    }

    /// Returns where the copies start.
    fn copy_open(&mut self, start: usize, end: usize) -> usize {
        let copies = self.found.rows.len();
        for index in start..end {
            if self.found.rows[index].is_open {
                self.found.rows.push(self.found.rows[index]);
            }
        }
        copies
    }

    fn alternation(&mut self, children: Span, start: usize, depth: u32) {
        let end = self.found.rows.len();
        let replaced = self.found.rows[start..]
            .iter()
            .filter(|row| row.is_open)
            .count();
        for &child in self.graph.children_of(children) {
            let copies = self.copy_open(start, end);
            self.visit(child, copies, depth + 1);
            self.reduce(end, replaced);
        }
        let mut index = 0;
        self.found.rows.retain(|row| {
            index += 1;
            index <= start || index > end || !row.is_open
        });
    }

    /// Joins rows from `start` on while there are too many, of which `spare` do not count.
    fn reduce(&mut self, start: usize, spare: usize) {
        while self.found.rows.len() > (MAX_ROWS + spare).max(start + 1) {
            let seconds = start + 1..self.found.rows.len();
            let second = seconds.min_by_key(|&it| self.loss_of_joining(it - 1, it));
            let second = second.expect("there are two rows");
            let removed = self.found.rows.remove(second);
            self.join(second - 1, &removed);
        }
    }

    fn loss_of_joining(&self, a: usize, b: usize) -> impl Ord + use<> {
        const USEFUL_LENGTH: u8 = 4;
        let (a, b) = (&self.found.rows[a], &self.found.rows[b]);
        let stays_open = a.is_open && b.is_open && a.length == b.length;
        let cuts_short = |row: &Row, other: &Row| {
            let reached = if row.is_open {
                USEFUL_LENGTH
            } else {
                row.length.min(USEFUL_LENGTH)
            };
            reached.saturating_sub(row.length.min(other.length))
        };
        let width = |row: &Row| {
            let first = row.cells().first();
            first.map_or(256, |&it| self.found.units(self.graph, it).latin1().len())
        };
        let lost = if stays_open {
            0
        } else {
            cuts_short(a, b) + cuts_short(b, a)
        };
        let start_alike = a.cells[0] == b.cells[0];
        (lost, if start_alike { 0 } else { width(a) + width(b) })
    }

    fn join(&mut self, index: usize, other: &Row) {
        let row = self.found.rows[index];
        let mut joined = Row {
            length: row.length.min(other.length),
            is_open: row.is_open && other.is_open && row.length == other.length,
            before: (row.before.zip(other.before)).map(|(a, b)| self.join_cells(a, b)),
            ..row
        };
        for column in 0..usize::from(joined.length) {
            joined.cells[column] = self.join_cells(row.cells[column], other.cells[column]);
        }
        self.found.rows[index] = joined;
    }

    fn join_cells(&mut self, a: Cell, b: Cell) -> Cell {
        if a == b {
            return a;
        }
        let units = self.found.units(self.graph, a) | self.found.units(self.graph, b);
        self.add_union(units)
    }
}
