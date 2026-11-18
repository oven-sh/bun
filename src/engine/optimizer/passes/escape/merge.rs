//! Where ways meet. Objects that are in the same place on all ways are taken for one, unless that makes two of one.

use bun_engine_codegen::analysis::Loop;
use bun_engine_codegen::ir::{Block, Type};
use smallvec::SmallVec;

use super::loops::MUST_BE_MADE;
use super::picture::{Entry, Id, MOST_ENTRIES, Picture, Positions, Word, members};
use super::{Arrival, Meaning, Sinking};

#[derive(Default)]
pub(super) struct Meeting {
    result: Picture,
    /// For each entry of the result, its position on each way.
    sources: Vec<u8>,
    /// For each way and each position there, one more than the position in the result.
    claims: Vec<u8>,
    /// Before anything else can be said.
    to_make: Vec<(usize, Id)>,
    /// `UNKNOWN` for those that stay.
    params: SmallVec<[Word; 8]>,
    /// What values that outlast the meeting point to.
    pinned: Positions,
}

type Column = SmallVec<[Word; 4]>;

impl Sinking<'_> {
    /// Returns false if no way leads there.
    pub(super) fn enter(&mut self, block: Block) -> bool {
        let mut arrivals = core::mem::take(&mut self.arrivals[block]);
        let headed = self.cfg.loop_headed_by(block);
        if arrivals.iter().all(|it| it.picture.entries.is_empty()) {
            self.now.clear();
            headed.inspect(|&it| self.heads[it].expect_nothing());
            return !arrivals.is_empty() || self.cfg.predecessors(block).is_empty();
        }
        if let ([only], None) = (&mut arrivals[..], headed)
            && self.graph.function.params(block).is_empty()
        {
            core::mem::swap(&mut self.now, &mut only.picture);
        } else {
            self.merge(block, &mut arrivals, headed);
        }
        (arrivals.into_iter()).for_each(|it| self.recycle(it.picture));
        true
    }

    fn merge(&mut self, block: Block, arrivals: &mut [Arrival], headed: Option<Loop>) {
        let mut meeting = core::mem::take(&mut self.meeting);
        loop {
            self.compare(&mut meeting, block, arrivals, headed);
            if meeting.to_make.is_empty() {
                break;
            }
            for (way, id) in meeting.to_make.drain(..) {
                self.make_on_the_way(&mut arrivals[way], id);
            }
        }
        self.settle_params(&meeting, block, arrivals);
        let varying = self.add_params(&mut meeting, block, arrivals);
        core::mem::swap(&mut self.now, &mut meeting.result);
        if let Some(headed) = headed {
            let params = meeting.params.len();
            self.heads[headed].expect(&self.now, varying, meeting.pinned, params);
        }
        self.meeting = meeting;
    }

    fn compare(
        &self,
        meeting: &mut Meeting,
        block: Block,
        arrivals: &[Arrival],
        headed: Option<Loop>,
    ) {
        meeting.result.clear();
        meeting.sources.clear();
        meeting.params.clear();
        meeting.claims.clear();
        meeting.claims.resize(arrivals.len() * MOST_ENTRIES, 0);
        let mut column = Column::new();
        for value in self.pointers.live_at_start(self.cfg.position(block)) {
            if let Some(id) = self.object_behind(value) {
                column.clear();
                column.resize(arrivals.len(), Word::object(id));
                self.meet(meeting, arrivals, &column, headed);
            }
        }
        meeting.pinned = (0..meeting.result.entries.len()).fold(0, |all, it| all | 1 << it);

        let function = &self.graph.function;
        for (position, &param) in function.params(block).iter().enumerate() {
            let args = arrivals.iter().map(|it| function.args(it.edge)[position]);
            column.clear();
            column.extend(args.map(|it| self.word_for(it).expect("of a register")));
            let is_object = column[0].as_object().is_some();
            let is_virtual = |id| arrivals[0].picture.entry(id).is_virtual();
            let stays = is_object && self.pointers.number(param).is_none()
                || headed.is_some() && !column[0].as_object().is_some_and(is_virtual);
            let met = match stays {
                true => meeting.keep_apart(arrivals, &column),
                false => self.meet(meeting, arrivals, &column, headed),
            };
            meeting.params.push(met);
        }

        let mut position = 0;
        while let Some(&entry) = meeting.result.entries.get(position) {
            let varying = headed.map_or(0, |it| self.heads[it].learned_about(entry.id));
            meeting.result.entries[position].first_word = meeting.result.words.len() as u32;
            for word in 0..usize::from(entry.word_count) {
                column.clear();
                column.extend(meeting.column(arrivals, position, word));
                let met = match varying >> word & 1 != 0 {
                    true => meeting.keep_apart(arrivals, &column),
                    false => self.meet(meeting, arrivals, &column, headed),
                };
                meeting.result.words.push(met);
            }
            position += 1;
        }
    }

    /// What can be said of a place that has this on each way.
    fn meet(
        &self,
        meeting: &mut Meeting,
        arrivals: &[Arrival],
        column: &[Word],
        headed: Option<Loop>,
    ) -> Word {
        let is_same = column.iter().all(|&it| it == column[0]);
        let positions: Option<SmallVec<[usize; 4]>> = (column.iter().zip(arrivals))
            .map(|(word, arrival)| Some(arrival.picture.position(word.as_object()?)))
            .collect();
        let Some(positions) = positions else {
            return match is_same {
                true => column[0],
                false => meeting.keep_apart(arrivals, column),
            };
        };
        let places = || {
            arrivals
                .iter()
                .map(|it| &it.picture)
                .zip(positions.iter().copied())
        };
        let first = arrivals[0].picture.entries[positions[0]];
        let claim = |(way, position)| meeting.claims[way * MOST_ENTRIES + position];
        let claimed = claim((0, positions[0]));
        let can_be_one = if first.is_virtual() {
            let must_be_made = |it| self.heads[it].learned_about(first.id) & MUST_BE_MADE != 0;
            let is_alike = |place: (&Picture, usize)| {
                place.0.entries[place.1].is_virtual()
                    && self.are_alike([(&arrivals[0].picture, positions[0]), place])
            };
            (positions.iter().copied().enumerate()).all(|it| claim(it) == claimed)
                && (claimed != 0 || !headed.is_some_and(must_be_made) && places().all(is_alike))
        } else {
            is_same && places().all(|(picture, position)| !picture.entries[position].is_virtual())
        };
        if !can_be_one {
            return meeting.keep_apart(arrivals, column);
        }
        if claimed == 0 {
            meeting.result.entries.push(first);
            for (way, &position) in positions.iter().enumerate() {
                meeting.sources.push(position as u8);
                meeting.claims[way * MOST_ENTRIES + position] = meeting.result.entries.len() as u8;
            }
        }
        column[0]
    }

    fn settle_params(&mut self, meeting: &Meeting, block: Block, arrivals: &[Arrival]) {
        let mut has_dead = false;
        for (position, &met) in meeting.params.iter().enumerate() {
            let param = self.graph.function.params(block)[position];
            if let Some(id) = met.as_object() {
                self.set_meaning(param, Meaning::Object(id));
            } else if let Some(value) = met.as_value() {
                self.set_meaning(param, Meaning::Value(value));
            }
            if self.is_on_trial() {
                continue;
            }
            if met.as_value().is_some() {
                self.may_have_needless_params = true;
            } else if met != Word::UNKNOWN {
                self.graph.function.remove_param(param);
                has_dead = true;
            } else {
                (arrivals.iter()).for_each(|it| self.pass_what_is_made(it, position));
            }
        }
        self.with_dead_params.extend(has_dead.then_some(block));
    }

    pub(super) fn pass_what_is_made(&mut self, arrival: &Arrival, position: usize) {
        if let Some(id) = self.object_behind(self.graph.function.args(arrival.edge)[position]) {
            let made = arrival.picture.value_of(Word::object(id));
            self.graph.function.args_mut(arrival.edge)[position] = made;
        }
    }

    /// Gives, for each entry, the words that have got one, and `MUST_BE_MADE` if the object itself has.
    fn add_params(
        &mut self,
        meeting: &mut Meeting,
        block: Block,
        arrivals: &[Arrival],
    ) -> SmallVec<[Positions; 8]> {
        let mut all_varying = SmallVec::new();
        for position in 0..meeting.result.entries.len() {
            let Entry {
                id, made, stamp, ..
            } = meeting.result.entries[position];
            let (mut is_unchanged, mut varying) = (true, 0);
            for (arrival, source) in meeting.sources(arrivals, position) {
                let entry = &arrival.picture.entries[source];
                is_unchanged &= entry.stamp == stamp;
                varying |= if entry.made == made { 0 } else { MUST_BE_MADE };
                self.take_for_one(id, entry.id);
            }
            let words = meeting.result.words_at(position).iter().enumerate();
            let unknown = words.filter(|it| *it.1 == Word::UNKNOWN);
            varying = unknown.fold(varying, |all, it| all | 1 << it.0);
            all_varying.push(varying);
            if !is_unchanged || varying != 0 {
                meeting.result.entries[position].stamp = self.new_stamp();
            }
            if varying == 0 || self.is_on_trial() {
                continue;
            }
            self.may_have_needless_params = true;
            for word in members(varying) {
                let param = self.graph.function.add_param(block, Type::I64);
                for (arrival, source) in meeting.sources(arrivals, position) {
                    self.pass(arrival, source, word);
                }
                if varying == MUST_BE_MADE {
                    let ty = self.graph.inherent_type(made);
                    self.graph.declare(param, ty);
                    meeting.result.entries[position].made = param;
                } else {
                    meeting.result.words_at_mut(position)[word] = Word::value(param);
                }
            }
        }
        all_varying
    }

    /// For the latest parameter, which is for a member of what `add_params` gives.
    pub(super) fn pass(&mut self, arrival: &Arrival, position: usize, word: usize) {
        let picture = &arrival.picture;
        let arg = match 1 << word == MUST_BE_MADE {
            true => picture.entries[position].made,
            false => picture.value_of(picture.words_at(position)[word]),
        };
        self.graph.function.push_arg(arrival.edge, arg);
    }
}

impl Meeting {
    fn sources<'a>(
        &self,
        arrivals: &'a [Arrival],
        position: usize,
    ) -> impl Iterator<Item = (&'a Arrival, usize)> {
        let sources = &self.sources[position * arrivals.len()..];
        arrivals.iter().zip(sources.iter().map(|&it| it.into()))
    }

    fn column(
        &self,
        arrivals: &[Arrival],
        position: usize,
        word: usize,
    ) -> impl Iterator<Item = Word> {
        (self.sources(arrivals, position))
            .map(move |(arrival, source)| arrival.picture.words_at(source)[word])
    }

    /// It takes a parameter.
    fn keep_apart(&mut self, arrivals: &[Arrival], column: &[Word]) -> Word {
        for (way, (word, arrival)) in column.iter().zip(arrivals).enumerate() {
            let is_virtual = |&id: &Id| arrival.picture.entry(id).is_virtual();
            (self.to_make).extend(word.as_object().filter(is_virtual).map(|id| (way, id)));
        }
        Word::UNKNOWN
    }
}
