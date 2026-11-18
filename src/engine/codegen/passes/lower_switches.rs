//! Turns switches into jump tables, tests of bits and comparisons.

use core::ops::Range;

use bun_engine_asm::Cond;

use super::Analyses;
use super::bounds::Bounds;
use crate::ir::{Block, Builder, Cases, Edge, Entity, Function, Op, Table, Type, Value};
use crate::target::Target;

const LEAST_RUNS_IN_TABLE: usize = 6;
const TABLE_ENTRIES_PER_KEY: i128 = 4;
/// Two comparisons settle a run of any length, so a long one is no reason for a large table.
const MOST_KEYS_COUNTED_PER_RUN: u64 = 8;
const MOST_ENTRIES_ADDED_TO_START_AT_ZERO: i64 = 8;
/// By the number of destinations, from one.
const LEAST_RUNS_IN_BIT_TEST: [usize; 3] = [3, 5, 6];
const WORD_BITS: u64 = 64;
const MOST_TESTS_IN_A_ROW: usize = 3;
const MOST_RUNS_TESTED_FIRST: usize = 2;
const MOST_COPIED_ARGS: usize = 4;
const LIKELY_WEIGHT: u64 = 8;
const NONE: u32 = u32::MAX;
const DEFAULT: u32 = 0;

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    if !function.has_cases() {
        return;
    }
    let mut lowering = Lowering {
        last_destination_at: function.block_table(NONE),
        ..Lowering::default()
    };
    for block in (0..function.block_count()).map(Block::from_index) {
        if let Some(last) = function.last(block).expand()
            && let Op::Switch(subject, cases) = *function.op(last)
        {
            lowering.lower(function, last, subject, cases);
            analyses.invalidate();
        }
    }
}

/// A target with arguments.
struct Destination {
    edge: Edge,
    is_rare: bool,
    earlier_at_target: u32,
    run_count: u32,
    /// In the jump table for the cluster that starts with this run.
    position: (usize, u32),
}

/// Consecutive keys with one destination.
#[derive(Clone, Copy)]
struct Run {
    least: i64,
    greatest: i64,
    destination: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Method {
    Comparison,
    Table,
    Bits,
}

#[derive(Clone)]
struct Cluster {
    method: Method,
    least: i64,
    greatest: i64,
    runs: Range<usize>,
    is_rare: bool,
    weight_before: u64,
}

/// What is known of the subject. The limits are included.
#[derive(Clone, Copy)]
struct Known {
    least: i64,
    greatest: i64,
}

#[derive(Clone, Copy)]
enum Next {
    Destination(u32),
    Block(Block, bool),
}

#[derive(Default)]
struct Lowering {
    last_destination_at: Table<Block, u32>,
    destinations: Vec<Destination>,
    runs: Vec<Run>,
    clusters: Vec<Cluster>,
    keys_before: Vec<i128>,
    least_slack_from: Vec<i128>,
    unfinished: Vec<(Block, Range<usize>, Known)>,
    entries: Vec<i64>,
    successors: Vec<u32>,
}

fn distance(least: i64, greatest: i64) -> u64 {
    greatest.wrapping_sub(least) as u64
}

impl Known {
    fn is_within(self, least: i64, greatest: i64) -> bool {
        least <= self.least && self.greatest <= greatest
    }

    /// The limits do not cover everything.
    fn without(self, least: i64, greatest: i64) -> Self {
        if least <= self.least {
            Self {
                least: self.least.max(greatest + 1),
                ..self
            }
        } else if self.greatest <= greatest {
            Self {
                greatest: self.greatest.min(least - 1),
                ..self
            }
        } else {
            self
        }
    }
}

impl Lowering {
    fn lower(&mut self, function: &mut Function, switch: Value, subject: Value, cases: Cases) {
        let block = function.block_of(switch);
        let bounds = Bounds::evident(function, subject);
        let mut known = Known {
            least: bounds.least,
            greatest: bounds.greatest,
        };
        self.collect_runs(function, block, cases, &bounds);
        self.share_long_lists_of_args(function);
        let origin = function.origin(switch);
        function.remove(switch);
        let mut builder = Builder::at_end(function, block);
        builder.origin = origin;
        self.test_likely_runs_first(&mut builder, subject, &mut known);
        self.form_clusters();
        self.unfinished
            .push((builder.block(), 0..self.clusters.len(), known));
        while let Some((block, clusters, known)) = self.unfinished.pop() {
            builder.switch_to(block);
            if clusters.len() <= MOST_TESTS_IN_A_ROW {
                self.test_in_a_row(&mut builder, subject, clusters, known);
            } else {
                self.divide(&mut builder, subject, clusters, known);
            }
        }
    }

    fn collect_runs(&mut self, function: &Function, block: Block, cases: Cases, bounds: &Bounds) {
        self.destinations.clear();
        self.runs.clear();
        let mut edges = function.successors(block);
        let default = edges.next_back().expect("a switch has a default");
        self.destination_of(function, default);
        for (&key, edge) in function.cases(cases).iter().zip(edges) {
            if !bounds.contains(key) {
                continue;
            }
            let destination = self.destination_of(function, edge);
            if destination != DEFAULT {
                self.runs.push(Run {
                    least: key,
                    greatest: key,
                    destination,
                });
            }
        }
        for destination in &self.destinations {
            self.last_destination_at[function.target(destination.edge)] = NONE;
        }
        self.runs.sort_unstable_by_key(|run| run.least);
        self.runs.dedup_by(|next, run| {
            let continues = next.destination == run.destination && next.least - 1 == run.greatest;
            if continues {
                run.greatest = next.greatest;
            }
            continues
        });
    }

    fn destination_of(&mut self, function: &Function, edge: Edge) -> u32 {
        const MOST_COMPARED: usize = 4;
        let target = function.target(edge);
        let last = self.last_destination_at[target];
        let earlier = core::iter::successors(Some(last).filter(|&known| known != NONE), |&known| {
            Some(self.destinations[known as usize].earlier_at_target).filter(|&known| known != NONE)
        });
        let is_same = |&known: &u32| {
            let other = self.destinations[known as usize].edge;
            function.target(other) == target && function.args(other) == function.args(edge)
        };
        let default = (last != NONE).then_some(DEFAULT);
        if let Some(known) = earlier.take(MOST_COMPARED).chain(default).find(is_same) {
            self.destinations[known as usize].is_rare &= function.is_rare(edge);
            return known;
        }
        self.last_destination_at[target] = self.destinations.len() as u32;
        self.destinations.push(Destination {
            edge,
            is_rare: function.is_rare(edge),
            earlier_at_target: last,
            run_count: 0,
            position: (usize::MAX, 0),
        });
        self.last_destination_at[target]
    }

    fn share_long_lists_of_args(&mut self, function: &mut Function) {
        self.destinations[DEFAULT as usize].run_count = self.runs.len() as u32;
        for run in &self.runs {
            self.destinations[run.destination as usize].run_count += 1;
        }
        for destination in &self.destinations {
            if destination.run_count > 1 && function.args(destination.edge).len() > MOST_COPIED_ARGS
            {
                function.split_edge(destination.edge);
            }
        }
    }

    fn is_rare(&self, destination: u32) -> bool {
        self.destinations[destination as usize].is_rare
    }

    fn test_likely_runs_first(
        &mut self,
        builder: &mut Builder<'_>,
        subject: Value,
        known: &mut Known,
    ) {
        let is_likely = |run: &Run| !self.destinations[run.destination as usize].is_rare;
        if self.runs.len() <= MOST_TESTS_IN_A_ROW
            || self.runs.iter().filter(|run| is_likely(run)).count() > MOST_RUNS_TESTED_FIRST
        {
            return;
        }
        while let Some(position) = self
            .runs
            .iter()
            .position(|run| !self.is_rare(run.destination))
        {
            let run = self.runs.remove(position);
            let rest = builder.new_block();
            let is_last = self.runs.iter().all(|run| self.is_rare(run.destination));
            let next = Next::Block(rest, is_last && self.is_rare(DEFAULT));
            self.compare(builder, subject, run, *known, next);
            *known = known.without(run.least, run.greatest);
            builder.switch_to(rest);
        }
    }

    fn form_clusters(&mut self) {
        self.prepare_search_for_tables();
        self.clusters.clear();
        let (mut start, mut weight_before) = (0, 0);
        while start < self.runs.len() {
            let (table_end, bits_end) = (self.end_of_table(start), self.end_of_bit_test(start));
            let (method, end) = match (table_end, bits_end) {
                (Some(table), Some(bits)) if table > bits => (Method::Table, table),
                (_, Some(bits)) => (Method::Bits, bits),
                (Some(table), None) => (Method::Table, table),
                (None, None) => (Method::Comparison, start + 1),
            };
            let (mut least, greatest) = (self.runs[start].least, self.runs[end - 1].greatest);
            let can_start_at_zero = match method {
                Method::Comparison => false,
                Method::Table => least <= MOST_ENTRIES_ADDED_TO_START_AT_ZERO,
                Method::Bits => greatest < WORD_BITS as i64,
            };
            if can_start_at_zero && least > 0 && (start == 0 || self.runs[start - 1].greatest < 0) {
                least = 0;
            }
            let runs = &self.runs[start..end];
            let is_rare = runs.iter().all(|run| self.is_rare(run.destination));
            self.clusters.push(Cluster {
                method,
                least,
                greatest,
                runs: start..end,
                is_rare,
                weight_before,
            });
            weight_before += if is_rare { 1 } else { LIKELY_WEIGHT };
            start = end;
        }
    }

    /// Runs `i..=j` are dense enough if `greatest[j] + 1 - least[i] <= factor * (keys_before[j + 1] - keys_before[i])`,
    /// in which what depends on `j` can be separated from what depends on `i`.
    fn prepare_search_for_tables(&mut self) {
        self.keys_before.clear();
        self.least_slack_from.clear();
        if self.runs.len() < LEAST_RUNS_IN_TABLE {
            return;
        }
        let mut keys = 0;
        for run in &self.runs {
            self.keys_before.push(keys);
            let counted = distance(run.least, run.greatest).min(MOST_KEYS_COUNTED_PER_RUN - 1) + 1;
            keys += i128::from(counted);
            self.least_slack_from
                .push(i128::from(run.greatest) + 1 - TABLE_ENTRIES_PER_KEY * keys);
        }
        if TABLE_ENTRIES_PER_KEY * keys > i32::MAX.into() {
            self.least_slack_from.clear();
        }
        let mut least = i128::MAX;
        for slack in self.least_slack_from.iter_mut().rev() {
            least = least.min(*slack);
            *slack = least;
        }
    }

    fn end_of_table(&self, start: usize) -> Option<usize> {
        let candidates = self
            .least_slack_from
            .get(start + LEAST_RUNS_IN_TABLE - 1..)?;
        let allowed =
            i128::from(self.runs[start].least) - TABLE_ENTRIES_PER_KEY * self.keys_before[start];
        match candidates.partition_point(|&slack| slack <= allowed) {
            0 => None,
            count => Some(start + LEAST_RUNS_IN_TABLE - 1 + count),
        }
    }

    fn end_of_bit_test(&self, start: usize) -> Option<usize> {
        let mut seen = [NONE; LEAST_RUNS_IN_BIT_TEST.len()];
        let (mut count, mut best) = (0, None);
        for (end, run) in (start + 1..).zip(&self.runs[start..]) {
            if distance(self.runs[start].least, run.greatest) >= WORD_BITS {
                break;
            }
            if !seen.contains(&run.destination) {
                if count == seen.len() {
                    break;
                }
                seen[count] = run.destination;
                count += 1;
            }
            if end - start >= LEAST_RUNS_IN_BIT_TEST[count - 1] {
                best = Some(end);
            }
        }
        best
    }

    fn divide(
        &mut self,
        builder: &mut Builder<'_>,
        subject: Value,
        clusters: Range<usize>,
        known: Known,
    ) {
        let (first, last) = (
            &self.clusters[clusters.start],
            &self.clusters[clusters.end - 1],
        );
        let half = first.weight_before.midpoint(last.weight_before);
        let inner = &self.clusters[clusters.start + 1..clusters.end - 1];
        let middle =
            clusters.start + 1 + inner.partition_point(|cluster| cluster.weight_before <= half);
        let pivot = self.clusters[middle].least;
        let below = Known {
            greatest: pivot - 1,
            ..known
        };
        let above = Known {
            least: pivot,
            ..known
        };
        let lower = self.next_for(builder, clusters.start..middle, below);
        let upper = self.next_for(builder, middle..clusters.end, above);
        let is_below = builder.less_than(subject, pivot);
        self.branch(builder, is_below, lower, upper);
    }

    fn next_for(&mut self, function: &mut Function, clusters: Range<usize>, known: Known) -> Next {
        let (first, last) = (
            &self.clusters[clusters.start],
            &self.clusters[clusters.end - 1],
        );
        if first.method == Method::Comparison && known.is_within(first.least, first.greatest) {
            return Next::Destination(self.runs[first.runs.start].destination);
        }
        let all_rare =
            last.is_rare && last.weight_before - first.weight_before == clusters.len() as u64 - 1;
        let block = function.new_block();
        self.unfinished.push((block, clusters, known));
        Next::Block(block, all_rare && self.is_rare(DEFAULT))
    }

    fn test_in_a_row(
        &mut self,
        builder: &mut Builder<'_>,
        subject: Value,
        clusters: Range<usize>,
        mut known: Known,
    ) {
        if clusters.is_empty() {
            return self.jump(builder, DEFAULT);
        }
        self.clusters[clusters.clone()].sort_by_key(|cluster| cluster.is_rare);
        for index in clusters.clone() {
            let cluster = self.clusters[index].clone();
            let is_certain = known.is_within(cluster.least, cluster.greatest);
            let next = if is_certain || index + 1 == clusters.end {
                Next::Destination(DEFAULT)
            } else {
                let is_rare = self.clusters[index + 1].is_rare && self.is_rare(DEFAULT);
                Next::Block(builder.new_block(), is_rare)
            };
            match cluster.method {
                Method::Comparison => {
                    self.compare(builder, subject, self.runs[cluster.runs.start], known, next);
                }
                Method::Table => self.look_up(builder, subject, &cluster, known, next),
                Method::Bits => self.test_bits(builder, subject, &cluster, known, next),
            }
            let Next::Block(block, _) = next else {
                return;
            };
            known = known.without(cluster.least, cluster.greatest);
            builder.switch_to(block);
        }
    }

    fn compare(&self, builder: &mut Builder<'_>, subject: Value, run: Run, known: Known, or: Next) {
        let matches = if known.is_within(run.least, run.greatest) {
            return self.jump(builder, run.destination);
        } else if run.least == run.greatest {
            builder.equal(subject, run.least)
        } else if run.least <= known.least {
            builder.less_or_equal(subject, run.greatest)
        } else if known.greatest <= run.greatest {
            builder.greater_or_equal(subject, run.least)
        } else {
            let index = builder.add(subject, run.least.wrapping_neg());
            builder.below_or_equal(index, distance(run.least, run.greatest))
        };
        self.branch(builder, matches, Next::Destination(run.destination), or);
    }

    /// Goes on in a block where the subject is within the limits, and gives its distance from the lower as an I32.
    fn index(
        &self,
        builder: &mut Builder<'_>,
        subject: Value,
        cluster: &Cluster,
        greatest: i64,
        known: Known,
        or: Next,
    ) -> Value {
        let index = builder.add(subject, cluster.least.wrapping_neg());
        if !known.is_within(cluster.least, greatest) {
            let inside = builder.new_block();
            let limit = distance(cluster.least, greatest);
            let is_inside = builder.compare(Cond::BelowEq, index, limit);
            self.branch(builder, is_inside, Next::Block(inside, cluster.is_rare), or);
            builder.switch_to(inside);
        }
        if builder.type_of(index) == Type::I64 {
            builder.wrap(index)
        } else {
            index
        }
    }

    fn look_up(
        &mut self,
        builder: &mut Builder<'_>,
        subject: Value,
        cluster: &Cluster,
        known: Known,
        or: Next,
    ) {
        let index = self.index(builder, subject, cluster, cluster.greatest, known, or);
        self.entries.clear();
        self.successors.clear();
        for run in cluster.runs.clone() {
            let run = self.runs[run];
            let (first, last) = (
                distance(cluster.least, run.least) as usize,
                distance(cluster.least, run.greatest) as usize,
            );
            if self.entries.len() < first {
                let position = self.position_in_table(cluster, DEFAULT);
                self.entries.resize(first, position);
            }
            let position = self.position_in_table(cluster, run.destination);
            self.entries.resize(last + 1, position);
        }
        let table = builder.add_cases(self.entries.iter().copied());
        builder.insert(Op::JumpTable(index, table), Type::Void);
        let block = builder.block();
        builder.clear_successors(block);
        for &destination in &self.successors {
            self.push_edge(builder, Next::Destination(destination));
        }
    }

    fn position_in_table(&mut self, cluster: &Cluster, destination: u32) -> i64 {
        let position = &mut self.destinations[destination as usize].position;
        if position.0 != cluster.runs.start {
            *position = (cluster.runs.start, self.successors.len() as u32);
            self.successors.push(destination);
        }
        position.1.into()
    }

    fn test_bits(
        &self,
        builder: &mut Builder<'_>,
        subject: Value,
        cluster: &Cluster,
        known: Known,
        or: Next,
    ) {
        let reaches_the_end = matches!(or, Next::Destination(DEFAULT))
            && cluster.least <= known.least
            && distance(cluster.least, known.greatest) < WORD_BITS;
        let greatest = if reaches_the_end {
            known.greatest
        } else {
            cluster.greatest
        };
        let bits = |least: i64, greatest: i64| {
            u64::MAX >> (WORD_BITS - 1 - distance(least, greatest))
                << distance(cluster.least, least)
        };
        let mut tests = [(0, NONE); LEAST_RUNS_IN_BIT_TEST.len()];
        for run in &self.runs[cluster.runs.clone()] {
            let test = tests
                .iter_mut()
                .find(|test| test.1 == run.destination || test.1 == NONE)
                .expect("the destinations were counted");
            *test = (test.0 | bits(run.least, run.greatest), run.destination);
        }
        let count = tests.partition_point(|test| test.1 != NONE);
        let tests = &mut tests[..count];
        tests.sort_by_key(|&(mask, destination)| (self.is_rare(destination), mask.count_zeros()));

        let index = self.index(builder, subject, cluster, greatest, known, or);
        let ty = if distance(cluster.least, greatest) < 32 {
            Type::I32
        } else {
            Type::I64
        };
        let mut left = bits(cluster.least.max(known.least), greatest.min(known.greatest));
        for (position, &(mask, destination)) in tests.iter().enumerate() {
            left &= !mask;
            if left == 0 {
                return self.jump(builder, destination);
            }
            let mask = builder.constant(ty, mask);
            let shifted = builder.shr(mask, index);
            let bit = builder.and(shifted, 1);
            let next = match tests.get(position + 1) {
                Some(&(_, next)) => Next::Block(
                    builder.new_block(),
                    self.is_rare(next) && self.is_rare(DEFAULT),
                ),
                None => Next::Destination(DEFAULT),
            };
            self.branch(builder, bit, Next::Destination(destination), next);
            if let Next::Block(block, _) = next {
                builder.switch_to(block);
            }
        }
    }

    fn jump(&self, builder: &mut Builder<'_>, destination: u32) {
        builder.insert(Op::Jump, Type::Void);
        let block = builder.block();
        builder.clear_successors(block);
        builder.push_copy_of(block, self.destinations[destination as usize].edge);
        let edge = builder.successor(block, 0);
        builder.set_rare(edge, false);
    }

    fn branch(&self, builder: &mut Builder<'_>, condition: Value, then: Next, or: Next) {
        builder.insert(Op::Branch(condition), Type::Void);
        let block = builder.block();
        builder.clear_successors(block);
        self.push_edge(builder, then);
        self.push_edge(builder, or);
    }

    fn push_edge(&self, builder: &mut Builder<'_>, next: Next) {
        let block = builder.block();
        let (edge, is_rare) = match next {
            Next::Block(target, is_rare) => (builder.push_successor(block, target.into()), is_rare),
            Next::Destination(destination) => {
                let destination = &self.destinations[destination as usize];
                let edge = builder.push_copy_of(block, destination.edge);
                (edge, destination.is_rare)
            }
        };
        builder.set_rare(edge, is_rare);
    }
}
