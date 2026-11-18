//! What holds at the head of a loop has to hold again at the end of each turn.

use bun_engine_codegen::ir::Block;
use smallvec::SmallVec;

use super::objects::MOST_WORDS;
use super::picture::{Id, MOST_ENTRIES, Picture, Positions, Word, members};
use super::{Arrival, Meaning, Sinking};

/// Among the words of an object that vary.
pub(super) const MUST_BE_MADE: Positions = 1 << MOST_WORDS;

#[derive(Clone, Default)]
pub(super) struct Head {
    /// From trials.
    learned: SmallVec<[(Id, Positions); 4]>,
    wants_all_made: bool,
    picture: Picture,
    /// For each entry, what has a parameter.
    varying: SmallVec<[Positions; 8]>,
    /// The entries that no other object can take the place of.
    pinned: Positions,
    original_params: usize,
}

impl Head {
    pub(super) fn learned_about(&self, id: Id) -> Positions {
        if self.wants_all_made {
            return MUST_BE_MADE;
        }
        let found = self.learned.iter().find(|it| it.0 == id);
        found.map_or(0, |it| it.1)
    }

    fn learn(&mut self, id: Id, more: Positions) {
        match self.learned.iter_mut().find(|it| it.0 == id) {
            Some(known) => known.1 |= more,
            None if more != 0 => self.learned.push((id, more)),
            None => {}
        }
    }

    pub(super) fn expect(
        &mut self,
        picture: &Picture,
        varying: SmallVec<[Positions; 8]>,
        pinned: Positions,
        original_params: usize,
    ) {
        // What a trial does not know may turn out to be the same on all ways in, and the trial has let it vary.
        for (entry, &words) in picture.entries.iter().zip(&varying) {
            self.learn(entry.id, words & !MUST_BE_MADE);
        }
        self.picture.clone_from(picture);
        (self.varying, self.pinned, self.original_params) = (varying, pinned, original_params);
    }

    pub(super) fn expect_nothing(&mut self) {
        self.expect(&Picture::default(), SmallVec::new(), 0, usize::MAX);
    }
}

/// Which object at the end of a turn is which at the head.
struct Pairing {
    /// By position at the head.
    sources: [Option<u8>; MOST_ENTRIES],
    taken: Positions,
    pending: Positions,
    to_make: SmallVec<[Id; 4]>,
    wrong: SmallVec<[(Id, Positions); 4]>,
}

impl Sinking<'_> {
    pub(super) fn settle(&mut self, block: Block) {
        const MOST_TRIALS: usize = 8;
        let Some(headed) = self.cfg.loop_headed_by(block) else {
            return;
        };
        if !(self.arrivals[block].iter()).any(|it| it.picture.has_virtual()) {
            return;
        }
        let function = &self.graph.function;
        let blocks = self.cfg.blocks_of(headed).iter();
        let steps: usize = blocks.map(|&it| function.instructions(it).count()).sum();
        let entering = core::mem::take(&mut self.arrivals[block]);
        self.trial = self.cfg.loops()[headed].positions();
        self.has_learned = true;
        for _ in 0..MOST_TRIALS.min(self.steps_left_for_trials / steps) {
            if !core::mem::take(&mut self.has_learned) {
                break;
            }
            self.steps_left_for_trials -= steps;
            self.arrivals[block].clone_from(&entering);
            self.walk(self.trial.clone());
            for value in self.found_on_trial.drain(..) {
                self.meanings[value] = Meaning::Itself;
            }
        }
        if self.has_learned {
            self.heads[headed].wants_all_made = true;
        } else {
            self.settled_until = self.trial.end;
        }
        self.trial = 0..0;
        self.arrivals[block] = entering;
    }

    pub(super) fn close_loop(&mut self, mut arrival: Arrival) {
        let block = self.graph.function.target(arrival.edge);
        let headed = self.cfg.loop_headed_by(block).expect("natural");
        if arrival.picture.entries.is_empty() && self.heads[headed].picture.entries.is_empty() {
            return;
        }
        let mut head = core::mem::take(&mut self.heads[headed]);
        let params = (head.original_params).min(self.graph.function.params(block).len());
        let pairing = loop {
            let pairing = self.pair_up(&head, block, params, &arrival);
            if pairing.to_make.is_empty() {
                break pairing;
            }
            (pairing.to_make.iter()).for_each(|&id| self.make_on_the_way(&mut arrival, id));
        };
        for (entry, source) in head.picture.entries.iter().zip(pairing.sources) {
            if let Some(source) = source {
                self.take_for_one(entry.id, arrival.picture.entries[usize::from(source)].id);
            }
        }
        if !self.is_on_trial() {
            debug_assert!(pairing.wrong.is_empty(), "as on the last trial");
            if !pairing.wrong.is_empty() {
                self.has_learned_too_late = true;
                return;
            }
            for position in 0..params {
                let param = self.graph.function.params(block)[position];
                if self.meaning(param) == Meaning::Itself {
                    self.pass_what_is_made(&arrival, position);
                }
            }
            for (position, &varying) in head.varying.iter().enumerate() {
                let same = || arrival.picture.position(head.picture.entries[position].id);
                for word in members(varying) {
                    let source = pairing.sources[position].map_or_else(same, usize::from);
                    self.pass(&arrival, source, word);
                }
            }
        }
        self.has_learned |= !pairing.wrong.is_empty();
        (pairing.wrong.into_iter()).for_each(|(id, more)| head.learn(id, more));
        self.heads[headed] = head;
        self.recycle(arrival.picture);
    }

    fn pair_up(&self, head: &Head, block: Block, params: usize, arrival: &Arrival) -> Pairing {
        let mut pairing = Pairing {
            sources: [None; MOST_ENTRIES],
            taken: 0,
            pending: 0,
            to_make: SmallVec::new(),
            wrong: SmallVec::new(),
        };
        let (expected, found) = (&head.picture, &arrival.picture);
        for position in members(head.pinned) {
            let entry = &expected.entries[position];
            if entry.is_virtual() {
                self.pair(
                    &mut pairing,
                    expected,
                    found,
                    entry.id,
                    Word::object(entry.id),
                );
            }
        }
        let function = &self.graph.function;
        let args = function.args(arrival.edge).iter().take(params);
        for (&param, &arg) in function.params(block).iter().zip(args) {
            let word = self.word_for(arg).expect("of a register");
            match self.meaning(param) {
                Meaning::Object(id) => self.pair(&mut pairing, expected, found, id, word),
                _ => pairing.want_made(found, word),
            }
        }
        while pairing.pending != 0 {
            let position = pairing.pending.trailing_zeros() as usize;
            pairing.pending &= pairing.pending - 1;
            let source = pairing.sources[position].expect("paired").into();
            let words = expected
                .words_at(position)
                .iter()
                .zip(found.words_at(source));
            for (index, (&old, &new)) in words.enumerate() {
                let is_virtual = |&id: &Id| expected.entry(id).is_virtual();
                if head.varying[position] >> index & 1 != 0 {
                    pairing.want_made(found, new);
                } else if let Some(id) = old.as_object().filter(is_virtual)
                    && new.as_object().is_some()
                {
                    self.pair(&mut pairing, expected, found, id, new);
                } else if old != new {
                    (pairing.wrong).push((expected.entries[position].id, 1 << index));
                }
            }
        }
        pairing
    }

    fn pair(&self, pairing: &mut Pairing, expected: &Picture, found: &Picture, id: Id, new: Word) {
        let position = expected.position(id);
        let source = new.as_object().map(|it| found.position(it));
        let fits = match (pairing.sources[position], source) {
            (Some(known), _) => source == Some(known.into()),
            (None, Some(source)) => {
                pairing.taken >> source & 1 == 0
                    && found.entries[source].is_virtual()
                    && self.are_alike([(expected, position), (found, source)])
            }
            (None, None) => false,
        };
        if !fits {
            pairing.wrong.push((id, MUST_BE_MADE));
        } else if let (None, Some(source)) = (pairing.sources[position], source) {
            pairing.sources[position] = Some(source as u8);
            pairing.taken |= 1 << source;
            pairing.pending |= 1 << position;
        }
    }
}

impl Pairing {
    fn want_made(&mut self, found: &Picture, word: Word) {
        let is_virtual = |&id: &Id| found.entry(id).is_virtual();
        self.to_make.extend(word.as_object().filter(is_virtual));
    }
}
