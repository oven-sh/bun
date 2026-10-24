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
        let words = (count as usize).div_ceil(64);
        let mut sets = vec![0u64; file_count * words];
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
        // What a file imports comes before the file, but for a cycle, which takes another round.
        let order = list_successors_first(successors);
        loop {
            let mut has_changed = false;
            for &file in &order {
                for successor in &successors[file] {
                    has_changed |= reached.add_set(file, successor.idx());
                }
            }
            if !has_changed {
                return reached;
            }
        }
    }

    fn add_set(&mut self, into: usize, from: usize) -> bool {
        if into == from {
            return false;
        }
        let mut has_changed = false;
        for word in 0..self.words {
            let added = self.sets[from * self.words + word];
            let held = &mut self.sets[into * self.words + word];
            has_changed |= added & !*held != 0;
            *held |= added;
        }
        has_changed
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

fn list_successors_first(successors: &[Vec<FileId>]) -> Vec<usize> {
    let mut order = Vec::new();
    let mut is_visited = vec![false; successors.len()];
    let mut path: Vec<(usize, usize)> = Vec::new();
    for start in 0..successors.len() {
        if successors[start].is_empty() || core::mem::replace(&mut is_visited[start], true) {
            continue;
        }
        path.push((start, 0));
        while let Some((file, next)) = path.last_mut() {
            let Some(successor) = successors[*file].get(*next) else {
                order.push(*file);
                path.pop();
                continue;
            };
            *next += 1;
            let successor = successor.idx();
            if !successors[successor].is_empty()
                && !core::mem::replace(&mut is_visited[successor], true)
            {
                path.push((successor, 0));
            }
        }
    }
    order
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
