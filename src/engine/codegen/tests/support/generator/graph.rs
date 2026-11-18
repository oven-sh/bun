//! Control flow without structure.

use bun_engine_asm::Cond;
use bun_engine_codegen::ir::{Binary, Block, Type, Value};

use super::control::Join;
use super::{Class, Generator, Scope};

/// Edges that do not lead to a later node use up fuel. The node after the last is the exit.
struct Graph {
    successors: Vec<Vec<usize>>,
    /// The first nodes, to which no edge leads.
    roots: usize,
}

impl Graph {
    /// The reachable nodes, each after those that dominate it, with those as a set of bits.
    fn dominance(&self) -> Vec<(usize, u32)> {
        let count = self.successors.len();
        let reachable_without = |removed: Option<usize>| {
            let mut pending: Vec<usize> = (0..self.roots).collect();
            let mut seen = 0u32;
            while let Some(node) = pending.pop() {
                if Some(node) != removed && seen >> node & 1 == 0 {
                    seen |= 1 << node;
                    pending.extend(self.successors.get(node).into_iter().flatten());
                }
            }
            seen
        };
        let without: Vec<u32> = (0..count)
            .map(|node| reachable_without(Some(node)))
            .collect();
        let reachable = reachable_without(None);
        let dominators_of = |node: usize| {
            let dominates = |&other: &usize| other != node && without[other] >> node & 1 == 0;
            (0..count)
                .filter(dominates)
                .fold(0u32, |set, other| set | 1 << other)
        };
        let mut nodes: Vec<_> = (0..count)
            .filter(|node| reachable >> node & 1 != 0)
            .map(|node| (node, dominators_of(node)))
            .collect();
        nodes.sort_by_key(|&(_, dominators)| dominators.count_ones());
        nodes
    }
}

impl Generator<'_> {
    fn draw_graph(&mut self, roots: usize) -> Graph {
        let count = roots + self.random.between(2, 7) as usize;
        let successors = (0..count).map(|node| {
            let mut targets = vec![
                self.random
                    .between((node + 1).max(roots) as i64, count as i64) as usize,
            ];
            for _ in 0..self.random.pick(&[0, 1, 1, 1, 2]) {
                targets.push(self.random.between(roots as i64, count as i64) as usize);
            }
            targets
        });
        Graph {
            successors: successors.collect(),
            roots,
        }
    }

    pub(super) fn graph_statement(&mut self, budget: u32) {
        let graph = self.draw_graph(1);
        let exit = self.fill_graph(&graph, &[self.block], budget);
        self.enter(&exit);
    }

    pub(super) fn graph_with_entries(&mut self) {
        let entries: Vec<Block> = (0..self.shape.entries).map(|_| self.add_entry()).collect();
        let graph = self.draw_graph(entries.len());
        let exit = self.fill_graph(&graph, &entries, self.shape.size * 2 / 3);
        self.scope = Scope::default();
        let mark = self.mark();
        self.enter(&exit);
        self.body(self.shape.size / 3);
        self.finish_with_return(mark);
    }

    fn fill_graph(&mut self, graph: &Graph, roots: &[Block], budget: u32) -> Join {
        let count = graph.successors.len();
        let joins: Vec<Join> = (roots.len()..count)
            .map(|_| self.join(&[Type::I32]))
            .collect();
        let exit = self.join(&[]);
        let most = self.random.between(1, 5) as u32;
        let most = most.min(self.shape.trips / self.trips);
        let outer_trips = self.trips;
        let mut left_behind: Vec<Scope> = vec![Scope::default(); count];
        let dominance = graph.dominance();
        let base = self.mark();
        for &(node, dominators) in &dominance {
            for &(other, _) in dominance
                .iter()
                .filter(|&&(other, _)| dominators >> other & 1 != 0)
            {
                let Scope {
                    values,
                    states,
                    spots,
                    conditions,
                    nodes,
                } = &left_behind[other];
                self.scope.values.extend(values);
                self.scope.states.extend(states);
                self.scope.spots.extend(spots);
                self.scope.conditions.extend(conditions);
                self.scope.nodes.extend(nodes);
            }
            let mark = self.mark();
            let fuel = match node.checked_sub(roots.len()) {
                Some(index) => {
                    self.trips = outer_trips * (most + 1);
                    self.enter(&joins[index])[0]
                }
                None => {
                    if roots.len() > 1 {
                        self.start_entry(roots[node]);
                    }
                    self.value_of(Class::Index {
                        ty: Type::I32,
                        below: most + 1,
                        is_guarded: true,
                    })
                }
            };
            self.learn(fuel, Class::Data(Type::I32));
            let share = budget / dominance.len() as u32 + self.random.below(2) as u32;
            self.body(share);
            self.leave_node(
                graph,
                node,
                fuel,
                &joins,
                &exit,
                dominators | 1 << node,
                mark,
            );
            left_behind[node] = Scope {
                values: self.scope.values.split_off(mark.values),
                states: self.scope.states.split_off(mark.states),
                spots: self.scope.spots.split_off(mark.spots),
                conditions: self.scope.conditions.split_off(mark.conditions),
                nodes: self.scope.nodes.split_off(mark.nodes),
            };
            self.restore(base);
        }
        for (node, join) in (roots.len()..).zip(&joins) {
            if dominance.iter().all(|&(reachable, _)| reachable != node) {
                self.block = join.block;
                self.builder().unreachable();
            }
        }
        self.trips = outer_trips;
        exit
    }

    fn leave_node(
        &mut self,
        graph: &Graph,
        node: usize,
        fuel: Value,
        joins: &[Join],
        exit: &Join,
        dominators: u32,
        mark: super::Mark,
    ) {
        let targets = &graph.successors[node];
        let way_to =
            |this: &mut Self, target: usize, fuel: Value| match joins.get(target - graph.roots) {
                Some(join) => this.way_to(join, &[fuel], dominators >> target & 1 != 0),
                None => this.way_to(exit, &[], false),
            };
        let goes_back = targets.iter().any(|&target| target <= node);
        let less = if goes_back {
            self.binary_constant(Binary::Add, fuel, -1)
        } else {
            fuel
        };
        match targets[..] {
            [only] => {
                let way = way_to(self, only, fuel);
                self.jump(way, mark);
            }
            [forward, other] if self.random.percent(80) => {
                let mut condition = self.boolean();
                if goes_back {
                    let has_fuel = self.compare_constant(Cond::Gt, fuel, 0);
                    condition = self.commutative(Binary::And, condition, has_fuel);
                }
                let ways = [way_to(self, other, less), way_to(self, forward, fuel)];
                self.use_up(mark);
                self.branch_either_way(condition, ways);
            }
            _ => {
                if goes_back {
                    let ways = [self.plain_way(), way_to(self, targets[0], fuel)];
                    self.use_up(mark);
                    let inner = self.mark();
                    self.branch_on_fuel(fuel, ways);
                    let ways = targets
                        .iter()
                        .map(|&target| way_to(self, target, less))
                        .collect();
                    self.choose_among(ways, inner);
                    // What came after the test does not dominate what the test leads to.
                    self.restore(inner);
                } else {
                    let ways = targets
                        .iter()
                        .map(|&target| way_to(self, target, fuel))
                        .collect();
                    self.choose_among(ways, mark);
                }
            }
        }
    }
}
