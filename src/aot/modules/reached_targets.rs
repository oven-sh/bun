use bun_sema::program::FileId;

/// By file: which of a few files the edges of a graph lead to from it, itself among them.
pub(super) struct ReachedTargets {
    words: usize,
    /// By file. `u32::MAX`: the file is no target.
    bit_of: Vec<u32>,
    /// By file, `words` each.
    sets: Vec<u64>,
}

/// The targets below the start of a walk that the walk has not come to.
pub(super) struct RemainingTargets {
    words: Vec<u64>,
}

impl ReachedTargets {
    /// `successors` is by file, and empty for a file that the walks do not go on from.
    pub(super) fn compute(
        targets: impl Iterator<Item = FileId>,
        successors: &[Vec<FileId>],
    ) -> ReachedTargets {
        let file_count = successors.len();
        let mut bit_of = vec![u32::MAX; file_count];
        let mut count = 0;
        for target in targets {
            if bit_of[target.idx()] == u32::MAX {
                bit_of[target.idx()] = count;
                count += 1;
            }
        }
        ReachedTargets::compute_for_numbered_targets(bit_of, count, successors)
    }

    fn compute_for_numbered_targets(
        bit_of: Vec<u32>,
        count: u32,
        successors: &[Vec<FileId>],
    ) -> ReachedTargets {
        let words = (count as usize).div_ceil(64);
        let mut sets = vec![0u64; successors.len() * words];
        for (file, &bit) in bit_of.iter().enumerate() {
            if bit != u32::MAX {
                sets[file * words + bit as usize / 64] |= 1 << (bit % 64);
            }
        }
        let mut reached = ReachedTargets {
            words,
            bit_of,
            sets,
        };
        if words == 0 {
            return reached;
        }
        reached.add_sets_of_successors(successors);
        reached
    }

    // Tarjan's algorithm: a cycle is complete once everything it leads to is, and its files lead to the same targets.
    fn add_sets_of_successors(&mut self, successors: &[Vec<FileId>]) {
        const NOT_VISITED: u32 = u32::MAX;
        let mut index_of = vec![NOT_VISITED; successors.len()];
        let mut lowest_reached = vec![0u32; successors.len()];
        let mut is_open = vec![false; successors.len()];
        let mut open: Vec<usize> = Vec::new();
        let mut path: Vec<(usize, usize)> = Vec::new();
        let mut visited = 0;
        for start in 0..successors.len() {
            if successors[start].is_empty() || index_of[start] != NOT_VISITED {
                continue;
            }
            path.push((start, 0));
            while let Some(&(file, next)) = path.last() {
                if next == 0 {
                    (index_of[file], lowest_reached[file]) = (visited, visited);
                    visited += 1;
                    is_open[file] = true;
                    open.push(file);
                }
                if let Some(successor) = successors[file].get(next) {
                    path.last_mut().expect("the path holds `file`").1 += 1;
                    let successor = successor.idx();
                    if successors[successor].is_empty() {
                        continue;
                    }
                    if index_of[successor] == NOT_VISITED {
                        path.push((successor, 0));
                    } else if is_open[successor] {
                        lowest_reached[file] = lowest_reached[file].min(index_of[successor]);
                    }
                    continue;
                }
                path.pop();
                if let Some(&(parent, _)) = path.last() {
                    lowest_reached[parent] = lowest_reached[parent].min(lowest_reached[file]);
                }
                if lowest_reached[file] != index_of[file] {
                    continue;
                }
                let first = open.iter().rposition(|&it| it == file);
                let cycle = open.split_off(first.expect("an open file is listed"));
                for &member in &cycle {
                    self.add_set(file, member);
                    for successor in &successors[member] {
                        self.add_set(file, successor.idx());
                    }
                }
                for &member in &cycle {
                    self.add_set(member, file);
                    is_open[member] = false;
                }
            }
        }
    }

    fn add_set(&mut self, into: usize, from: usize) {
        if into == from {
            return;
        }
        for word in 0..self.words {
            self.sets[into * self.words + word] |= self.sets[from * self.words + word];
        }
    }

    fn set_of(&self, file: FileId) -> &[u64] {
        &self.sets[file.idx() * self.words..(file.idx() + 1) * self.words]
    }

    pub(super) fn is_target(&self, file: FileId) -> bool {
        self.bit_of[file.idx()] != u32::MAX
    }

    pub(super) fn leads_to_target(&self, file: FileId) -> bool {
        self.set_of(file).iter().any(|&word| word != 0)
    }

    pub(super) fn start_walk(&self, start: FileId) -> RemainingTargets {
        RemainingTargets {
            words: self.set_of(start).to_vec(),
        }
    }
}

impl RemainingTargets {
    pub(super) fn is_empty(&self) -> bool {
        self.words.iter().all(|&word| word == 0)
    }

    /// The edges lead from `file` to a target that the walk has not come to.
    pub(super) fn has_some_below(&self, reached: &ReachedTargets, file: FileId) -> bool {
        let mut pairs = self.words.iter().zip(reached.set_of(file));
        pairs.any(|(&left, &below)| left & below != 0)
    }

    /// The walk has come to `file`. `true`: it is a target, for the first time.
    pub(super) fn take(&mut self, reached: &ReachedTargets, file: FileId) -> bool {
        let bit = reached.bit_of[file.idx()];
        if bit == u32::MAX {
            return false;
        }
        let word = &mut self.words[bit as usize / 64];
        let mask = 1 << (bit % 64);
        let is_first = *word & mask != 0;
        *word &= !mask;
        is_first
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(edges: &[&[u32]]) -> Vec<Vec<FileId>> {
        edges
            .iter()
            .map(|targets| targets.iter().map(|&target| FileId(target)).collect())
            .collect()
    }

    fn below(reached: &ReachedTargets, file: u32, count: u32) -> Vec<u32> {
        let mut remaining = reached.start_walk(FileId(file));
        (0..count)
            .filter(|&target| remaining.take(reached, FileId(target)))
            .collect()
    }

    #[test]
    fn a_file_leads_to_the_targets_below_it_and_to_itself() {
        let successors = graph(&[&[1, 2], &[3], &[4], &[], &[], &[0]]);
        let reached = ReachedTargets::compute([3, 4, 1].into_iter().map(FileId), &successors);
        assert_eq!(below(&reached, 0, 6), [1, 3, 4]);
        assert_eq!(below(&reached, 1, 6), [1, 3]);
        assert_eq!(below(&reached, 2, 6), [4]);
        assert_eq!(below(&reached, 5, 6), [1, 3, 4]);
        assert!(reached.is_target(FileId(1)) && !reached.is_target(FileId(0)));
    }

    #[test]
    fn every_file_of_a_cycle_leads_to_what_one_of_them_leads_to() {
        let successors = graph(&[&[1], &[2], &[0, 3], &[], &[]]);
        let reached = ReachedTargets::compute([3].into_iter().map(FileId), &successors);
        for file in 0..3 {
            assert_eq!(below(&reached, file, 5), [3]);
        }
        assert!(!reached.leads_to_target(FileId(4)));
    }

    #[test]
    fn a_cycle_leads_to_what_a_cycle_below_it_leads_to() {
        let successors = graph(&[&[1], &[0, 2], &[3], &[2, 4], &[], &[0], &[3, 6]]);
        let reached = ReachedTargets::compute([4, 2].into_iter().map(FileId), &successors);
        for file in [0, 1, 2, 3, 5, 6] {
            assert_eq!(below(&reached, file, 7), [2, 4]);
        }
        assert_eq!(below(&reached, 4, 7), [4]);
    }

    #[test]
    fn a_walk_passes_by_what_leads_to_nothing_new() {
        let successors = graph(&[&[1, 2], &[3], &[3], &[]]);
        let reached = ReachedTargets::compute([3].into_iter().map(FileId), &successors);
        let mut remaining = reached.start_walk(FileId(0));
        assert!(remaining.has_some_below(&reached, FileId(1)));
        assert!(remaining.take(&reached, FileId(3)));
        assert!(!remaining.take(&reached, FileId(3)));
        assert!(!remaining.has_some_below(&reached, FileId(2)));
        assert!(remaining.is_empty());
    }

    #[test]
    fn more_targets_than_a_word_holds() {
        let mut edges: Vec<Vec<FileId>> = vec![(1..=130).map(FileId).collect()];
        edges.resize_with(131, Vec::new);
        let reached = ReachedTargets::compute((1..=130).map(FileId), &edges);
        assert_eq!(below(&reached, 0, 131).len(), 130);
    }

    #[test]
    fn without_targets_nothing_leads_anywhere() {
        let successors = graph(&[&[1], &[]]);
        let reached = ReachedTargets::compute(core::iter::empty(), &successors);
        assert!(!reached.leads_to_target(FileId(0)));
        assert!(reached.start_walk(FileId(0)).is_empty());
    }
}
