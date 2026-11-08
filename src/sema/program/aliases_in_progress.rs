use super::Sym;
use crate::util::FxHashMap;

#[derive(Default)]
pub(super) struct AliasesInProgress {
    aliases: Vec<Sym>,
    places: FxHashMap<Sym, usize>,
    cycles: Vec<std::ops::Range<usize>>,
}

impl AliasesInProgress {
    pub(super) fn len(&self) -> usize {
        self.aliases.len()
    }

    pub(super) fn aliases(&self) -> &[Sym] {
        &self.aliases
    }

    pub(super) fn place_of(&self, alias: Sym) -> Option<usize> {
        self.places.get(&alias).copied()
    }

    pub(super) fn push(&mut self, alias: Sym) {
        self.places.insert(alias, self.aliases.len());
        self.aliases.push(alias);
    }

    pub(super) fn note_cycle_from(&mut self, mut start: usize) {
        while let Some(found) = self.cycles.pop_if(|found| found.end >= start) {
            start = start.min(found.start);
        }
        self.cycles.push(start..self.aliases.len());
    }

    pub(super) fn pop(&mut self) -> bool {
        if let Some(alias) = self.aliases.pop() {
            self.places.remove(&alias);
        }
        let left = self.aliases.len();
        let Some(found) = self.cycles.last_mut().filter(|found| found.end > left) else {
            return false;
        };
        found.end = left;
        if found.start == left {
            self.cycles.pop();
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bind::SymbolId;
    use crate::program::FileId;

    #[derive(Copy, Clone)]
    enum Step {
        Push,
        Pop,
        CycleFrom(usize),
    }

    fn alias(number: usize) -> Sym {
        Sym {
            file: FileId(0),
            id: SymbolId(number as u32),
        }
    }

    fn run(steps: &[Step]) -> (Vec<(usize, bool)>, Vec<(usize, bool)>) {
        let mut stretches = AliasesInProgress::default();
        let mut flags: Vec<(usize, bool)> = Vec::new();
        let mut removed = (Vec::new(), Vec::new());
        let mut pushed = 0;
        let ends = std::iter::repeat_n(Step::Pop, steps.len());
        for step in steps.iter().copied().chain(ends) {
            match step {
                Step::Push => {
                    stretches.push(alias(pushed));
                    flags.push((pushed, false));
                    pushed += 1;
                }
                Step::Pop => {
                    let Some(last) = flags.pop() else { continue };
                    assert_eq!(stretches.place_of(alias(last.0)), Some(flags.len()));
                    removed.0.push((last.0, stretches.pop()));
                    removed.1.push(last);
                    assert_eq!(stretches.place_of(alias(last.0)), None);
                }
                Step::CycleFrom(start) => {
                    stretches.note_cycle_from(start);
                    flags[start..].iter_mut().for_each(|it| it.1 = true);
                }
            }
            assert_eq!(stretches.len(), flags.len());
        }
        removed
    }

    fn try_all(steps: &mut Vec<Step>, in_progress: usize, left: usize) -> usize {
        let (by_stretches, by_flags) = run(steps);
        assert_eq!(by_stretches, by_flags);
        if left == 0 {
            return 1;
        }
        let pop = (in_progress > 0).then_some((Step::Pop, in_progress.wrapping_sub(1)));
        let cycles = (0..in_progress).map(|start| (Step::CycleFrom(start), in_progress));
        let next = std::iter::once((Step::Push, in_progress + 1));
        let mut tried = 1;
        for (step, in_progress) in next.chain(pop).chain(cycles) {
            steps.push(step);
            tried += try_all(steps, in_progress, left - 1);
            steps.pop();
        }
        tried
    }

    #[test]
    fn stretches_say_what_a_flag_for_each_alias_says() {
        assert_eq!(try_all(&mut Vec::new(), 0, 10), 318_672);
    }

    #[test]
    fn alias_pushed_behind_a_cycle_is_in_none() {
        use Step::*;
        let steps = [
            Push,
            Push,
            Push,
            CycleFrom(1),
            Pop,
            Push,
            Push,
            CycleFrom(3),
        ];
        let removed = run(&steps).0;
        assert_eq!(
            removed,
            [(2, true), (4, true), (3, false), (1, true), (0, false)]
        );
    }
}
