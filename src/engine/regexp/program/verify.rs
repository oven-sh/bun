//! Proves in one pass that a program stays inside the subject, its cells, its captures, its stack and its tables.

use core::ops::Deref;

use super::{
    Join, LoopId, MAX_LENGTH, Op, Pairs, Place, Program, Progress, Room, Scan, Scope, ScopeId,
    ScopeKind, SiteId, Slot, Step, Target, Width,
};
use crate::compile::Purpose;
use crate::compile::memory::fill;

/// A program that can run without checks of its own.
#[derive(Clone, Copy)]
pub struct Verified<'a>(&'a Program);

impl Deref for Verified<'_> {
    type Target = Program;

    #[inline]
    fn deref(&self) -> &Program {
        self.0
    }
}

impl Program {
    /// Nothing for a program that memoizes, which is only interpreted.
    pub fn verify(&self) -> Option<Verified<'_>> {
        self.verify_in(&mut Memory::new())
    }

    pub(crate) fn verify_in(&self, memory: &mut Memory) -> Option<Verified<'_>> {
        (self.purpose != Purpose::Memoizing && self.is_sound(memory)).then_some(Verified(self))
    }

    pub(crate) fn is_sound(&self, memory: &mut Memory) -> bool {
        (Verifier::new(self, memory).and_then(Verifier::run)).is_some()
    }
}

pub(crate) struct Memory {
    kin: Vec<Kin>,
    join_at: Vec<u32>,
    switch_is_used: Vec<bool>,
}

impl Memory {
    pub(crate) const fn new() -> Memory {
        Memory {
            kin: Vec::new(),
            join_at: Vec::new(),
            switch_is_used: Vec::new(),
        }
    }
}

#[inline]
fn require(condition: bool) -> Option<()> {
    condition.then_some(())
}

const ROOT: ScopeId = ScopeId(0);
const NO_JOIN: u32 = u32::MAX;

#[derive(Clone, Copy)]
struct Kin {
    last_descendant: u32,
    descendants: u32,
    /// The nearest ancestor that is more than a reservation.
    base: ScopeId,
    /// The nearest scope from here up that says what is on top of the stack.
    stack: ScopeId,
    has_choice: bool,
}

#[derive(Clone, Copy)]
struct State {
    room: Room,
    scope: ScopeId,
}

struct Verifier<'a> {
    program: &'a Program,
    kin: &'a [Kin],
    join_at: &'a [u32],
    switch_is_used: &'a mut [bool],
    has_scan: bool,
}

impl<'a> Verifier<'a> {
    fn new(program: &'a Program, memory: &'a mut Memory) -> Option<Verifier<'a>> {
        let Memory {
            kin,
            join_at,
            switch_is_used,
        } = memory;
        fill(join_at, program.ops.len(), NO_JOIN).ok()?;
        fill(switch_is_used, program.switches.len(), false).ok()?;
        relate_scopes(program, kin)?;
        for (index, join) in program.joins.iter().enumerate() {
            require(index == 0 || program.joins[index - 1].at < join.at)?;
            require(join.scope.index() < program.scopes.len())?;
            require(join.room.ahead <= MAX_LENGTH && join.room.behind <= MAX_LENGTH)?;
            *join_at.get_mut(join.at.index())? = index as u32;
        }
        let verifier = Verifier {
            program,
            kin,
            join_at,
            switch_is_used,
            has_scan: false,
        };
        verifier.check_tables()?;
        Some(verifier)
    }

    fn check_tables(&self) -> Option<()> {
        let program = self.program;
        for (index, it) in program.loops.iter().enumerate() {
            let id = LoopId(index as u32);
            require(self.kind_of(it.turns)? == ScopeKind::Turns(id))?;
            require(self.scope(it.in_turn)?.kind == ScopeKind::InTurn(id))?;
            let between_turns = self.scope(it.between_turns)?;
            require(between_turns.kind == ScopeKind::BetweenTurns(id))?;
            require(between_turns.height == it.end_cell)?;
            self.check_pairs(it.pairs)?;
            require(it.room.ahead <= MAX_LENGTH && it.room.behind <= MAX_LENGTH)?;
            let back = self.join(it.back_into_turn)?;
            require(back.room == Room::NONE && self.encloses(it.in_turn, back.scope))?;
            require(self.scope(back.scope)?.height <= it.end_cell)?;
        }
        for &target in &program.choice_targets {
            require(self.join(target)?.room == Room::NONE)?;
        }
        let mut pairs = program.referenced_pairs.iter();
        require(pairs.all(|&pair| pair < program.pair_count))
    }

    fn run(mut self) -> Option<()> {
        let mut state = Some(State {
            room: Room::NONE,
            scope: ROOT,
        });
        for (index, op) in self.program.ops.iter().enumerate() {
            if let Some(join) = self.join(Target(index as u32)) {
                if let Some(state) = state {
                    self.go(state, join.at)?;
                }
                state = Some(State {
                    room: join.room,
                    scope: join.scope,
                });
            }
            let after = self.step(*op, state?)?;
            state = op.falls_through().then_some(after);
        }
        require(state.is_none())
    }

    fn scope(&self, id: ScopeId) -> Option<&'a Scope> {
        self.program.scopes.get(id.index())
    }

    fn join(&self, target: Target) -> Option<&'a Join> {
        let index = *self.join_at.get(target.index())?;
        self.program.joins.get(index as usize)
    }

    fn encloses(&self, outer: ScopeId, inner: ScopeId) -> bool {
        outer <= inner && inner.0 <= self.kin[outer.index()].last_descendant
    }

    /// Going from `inner` to `outer` only forgets about cells.
    fn widen(&self, inner: ScopeId, outer: ScopeId) -> Option<()> {
        require(self.encloses(outer, inner))?;
        require(self.kin[inner.index()].stack == self.kin[outer.index()].stack)
    }

    fn go(&self, from: State, to: Target) -> Option<()> {
        let join = self.join(to)?;
        require(from.room.covers(join.room))?;
        self.widen(from.scope, join.scope)
    }

    fn kind_of(&self, slot: Slot) -> Option<ScopeKind> {
        let scope = self.scope(slot.scope)?;
        let owner = match scope.kind {
            ScopeKind::Choice { .. } => self.scope(scope.parent)?,
            _ => scope,
        };
        require(slot.cell == self.scope(owner.parent)?.height && slot.cell < owner.height)?;
        Some(scope.kind)
    }

    /// For an operation that gives the slot its value.
    fn enter(&self, state: &mut State, slot: Slot) -> Option<ScopeKind> {
        let kind = self.kind_of(slot)?;
        self.widen(state.scope, self.kin[slot.scope.index()].base)?;
        state.scope = slot.scope;
        Some(kind)
    }

    /// For an operation that relies on the value of the slot.
    fn read(&self, state: State, slot: Slot) -> Option<ScopeKind> {
        let kind = self.kind_of(slot)?;
        require(self.encloses(slot.scope, state.scope))?;
        Some(kind)
    }

    fn room_at_slot(&self, state: State, slot: Slot) -> Option<Room> {
        match self.read(state, slot)? {
            ScopeKind::Position(room) => Some(room),
            _ => None,
        }
    }

    fn room_at(&self, state: State, place: Place) -> Option<Room> {
        self.room_at_slot(state, place.slot)?.moved(place.delta)
    }

    fn save(&self, state: &mut State, slot: Slot) -> Option<()> {
        match self.enter(state, slot)? {
            ScopeKind::Position(promised) => require(state.room.covers(promised)),
            _ => None,
        }
    }

    /// The scopes further out enclose those of the innermost loops.
    fn check_site(&self, state: State, site: SiteId) -> Option<()> {
        let sites = &self.program.sites;
        require(self.program.purpose == Purpose::Memoizing)?;
        let site = sites.sites.get(site.index())?;
        match sites.counters(site).next().map(|it| it.progress) {
            Some(Progress::Turns(slot)) => drop(self.read(state, slot)?),
            Some(Progress::Distance(start, _)) => drop(self.room_at_slot(state, start.slot)?),
            None => {}
        }
        if let Some((mark, found)) = sites.look(site) {
            require(self.read(state, mark)? == ScopeKind::Mark)?;
            let scope = mark.scope;
            self.go(State { scope, ..state }, found)?;
        }
        if let Some(turn) = sites.turns(site).next() {
            self.room_at_slot(state, turn.place.slot)?;
        }
        Some(())
    }

    fn check_pairs(&self, pairs: Pairs) -> Option<()> {
        require(pairs.first <= pairs.end && pairs.end <= self.program.pair_count)
    }

    fn check_saved_pairs(&self, slot: Slot, pairs: Pairs) -> Option<()> {
        self.check_pairs(pairs)?;
        let cells = self.scope(slot.scope)?.height - slot.cell;
        require(pairs.entries().len() <= cells as usize)
    }

    fn check_entry(&self, entry: u32) -> Option<()> {
        require((entry as usize) < self.program.capture_entries())
    }

    /// Returns what holds if the operation falls through.
    fn step(&mut self, op: Op, mut state: State) -> Option<State> {
        let program = self.program;
        let room = state.room;
        let is_wide = program.width == Width::Utf16;
        let has_class = |class: super::ClassId| require(class.index() < program.classes.len());
        match op {
            Op::Jump { to } | Op::Again { to } => self.go(state, to)?,
            Op::NoMatch | Op::Spend { .. } => {}
            Op::CountTurn => require(program.counts_turns())?,
            Op::Match { start, end } => {
                self.room_at(state, start)?;
                require(room.has(end.into(), 0))?;
            }
            Op::MatchHere { start, end } => {
                require(room.has(start.into(), 0) && room.has(end.into(), 0))?;
            }
            Op::Need {
                direction,
                count,
                fail,
            } => {
                require(count <= MAX_LENGTH)?;
                self.go(state, fail)?;
                state.room = room.with(direction, count.max(room.toward(direction)));
            }
            Op::AtEdge {
                direction,
                offset,
                fail,
            } => {
                self.go(state, fail)?;
                let distance = direction.signed(offset.into()).max(0).unsigned_abs();
                state.room = room.with(direction, distance.max(room.toward(direction)));
            }
            Op::NotInPair { offset, fail } => {
                require(is_wide && room.has(offset.into(), 0))?;
                self.go(state, fail)?;
            }
            Op::Unit {
                offset,
                value,
                mask,
                fail,
            } => {
                require(room.has(offset.into(), 1) && value | mask <= program.width.max_unit())?;
                self.go(state, fail)?;
            }
            Op::Word {
                bytes,
                offset,
                fail,
                ..
            } => {
                require(matches!(bytes, 2 | 4 | 8))?;
                let units = u32::from(bytes) / program.width.bytes_per_unit();
                require(room.has(offset.into(), units))?;
                self.go(state, fail)?;
            }
            Op::Class {
                offset,
                class,
                fail,
            } => {
                has_class(class)?;
                require(room.has(offset.into(), 1))?;
                self.go(state, fail)?;
            }
            Op::ClassCount {
                offset,
                count,
                class,
                fail,
            } => {
                has_class(class)?;
                require(count != 0 && room.has(offset.into(), count.into()))?;
                self.go(state, fail)?;
            }
            Op::Pair {
                offset,
                class,
                fail,
            } => {
                has_class(class)?;
                require(is_wide && room.has(offset.into(), 2))?;
                self.go(state, fail)?;
            }
            Op::Switch { offset, table } => {
                require(room.has(offset.into(), 1))?;
                let is_used = self.switch_is_used.get_mut(table.index())?;
                require(!core::mem::replace(is_used, true))?;
                let cases = program.switch(table).cases();
                require(cases.first()?.first == 0)?;
                require(cases.is_sorted_by(|a, b| a.first < b.first))?;
                require(cases.last()?.first <= program.width.max_unit())?;
                let latin1 = &program.switch(table).latin1;
                require(latin1.iter().all(|&it| usize::from(it) < cases.len()))?;
                for case in cases {
                    self.go(state, case.target)?;
                }
            }
            Op::Advance { by } => state.room = room.moved(by)?,
            Op::LeavePair => {
                require(is_wide)?;
                state.room.behind = room.behind.saturating_sub(1);
            }
            Op::SkipToTail { length } => {
                require(length <= MAX_LENGTH)?;
                state.room.ahead = room.ahead.min(length);
            }
            Op::Scan { id, fail } => {
                let scan = program.scans.get(id.index())?;
                require(!core::mem::replace(&mut self.has_scan, true))?;
                require(scan.need != 0 && scan.need <= MAX_LENGTH)?;
                require(
                    scan.others.len() <= Scan::MAX_PROBES
                        && scan.rows.len() <= Scan::MAX_ROW_PROBES,
                )?;
                for probe in core::iter::once(&scan.first).chain(&scan.others) {
                    match probe.step {
                        Step::Unit { value, mask } => {
                            require(value | mask <= program.width.max_unit())?;
                        }
                        Step::Class(class) => has_class(class)?,
                    }
                }
                state.room.ahead = 0;
                self.go(state, fail)?;
                state.room.ahead = scan.need;
                require(scan.offsets().all(|it| state.room.has(it.into(), 1)))?;
            }
            Op::WalkBack {
                slot, found, class, ..
            } => {
                has_class(class)?;
                let at_floor = self.room_at_slot(state, slot)?;
                let scope = found;
                self.save(&mut state, Slot { scope, ..slot })?;
                state.room.behind = room.behind.min(at_floor.behind);
            }
            Op::Save { slot } => self.save(&mut state, slot)?,
            Op::SaveStart { slot, fail } => {
                self.go(state, fail)?;
                self.save(&mut state, slot)?;
            }
            Op::Load { from, metered } => {
                if metered {
                    self.room_at_slot(state, program.attempt)?;
                }
                state.room = self.room_at(state, from)?;
            }
            Op::ComparePlace {
                when,
                offset,
                place,
                to,
            } => {
                let at_slot = self.room_at_slot(state, place.slot)?;
                self.go(state, to)?;
                let distance = i64::from(place.delta) - i64::from(offset);
                state.room = room.unless(when, at_slot, distance);
            }
            Op::Run {
                direction,
                code_points,
                class,
                reserve,
                ..
            } => {
                has_class(class)?;
                require((is_wide || !code_points) && room.toward(direction) >= reserve)?;
                state.room = room.with(direction, reserve);
            }
            Op::GiveBack {
                direction,
                stride,
                floor,
                filter,
                fail,
            } => {
                filter.class().map_or(Some(()), has_class)?;
                require(is_wide || !stride.is_code_point())?;
                let back = direction.opposite();
                let at_floor = self.room_at(state, floor)?.toward(back);
                state.room = room.with(back, 0);
                self.go(state, fail)?;
                let step = back.signed(stride.least_units() as i32);
                let before_step = room.with(back, stride.least_units());
                state.room = before_step.moved(step)?.with(back, at_floor);
            }
            Op::CodePoint {
                direction,
                class,
                reserve,
                fail,
            } => {
                has_class(class)?;
                require(is_wide && room.toward(direction) > reserve)?;
                self.go(state, fail)?;
                state.room = room.moved(direction.signed(1))?.with(direction, reserve);
            }
            Op::BackReference {
                direction,
                first,
                count,
                reserve,
                fail,
                ..
            } => {
                let end = first.checked_add(count)?;
                require(end as usize <= program.referenced_pairs.len())?;
                require(room.toward(direction) >= reserve)?;
                self.go(state, fail)?;
                state.room = room.with(direction, reserve);
            }
            Op::Capture { offset, entry } => {
                self.check_entry(entry)?;
                require(room.has(offset.into(), 0))?;
            }
            Op::CapturePlace { place, entry } => {
                self.check_entry(entry)?;
                self.room_at(state, place)?;
            }
            Op::Clear { pairs } => self.check_pairs(pairs)?,
            Op::SaveCaptures { slot, pairs } => {
                require(self.enter(&mut state, slot)? == ScopeKind::Numbers)?;
                self.check_saved_pairs(slot, pairs)?;
            }
            Op::RestoreCaptures { slot, pairs } => {
                require(self.read(state, slot)? == ScopeKind::Numbers)?;
                self.check_saved_pairs(slot, pairs)?;
            }
            Op::Zero { slot } => require(self.enter(&mut state, slot)? == ScopeKind::Numbers)?,
            Op::Increment { slot } | Op::RaiseTo { slot, .. } => {
                require(self.read(state, slot)? == ScopeKind::Numbers)?;
            }
            Op::CompareNumber { slot, to, .. } => {
                let kind = self.read(state, slot)?;
                require(matches!(kind, ScopeKind::Numbers | ScopeKind::Turns(_)))?;
                self.go(state, to)?;
            }
            Op::Choose {
                slot,
                index,
                target,
            } => {
                self.choose(state, slot, index, target)?;
                state.scope = slot.scope;
            }
            Op::Resume { slot } => {
                require(matches!(self.kind_of(slot)?, ScopeKind::Choice { .. }))?;
                self.widen(state.scope, slot.scope)?;
            }
            Op::Enter { id } => {
                let it = program.loops.get(id.index())?;
                self.enter(&mut state, it.turns)?;
                state.scope = it.between_turns;
            }
            Op::Push { id } => {
                let it = program.loops.get(id.index())?;
                self.widen(state.scope, it.between_turns)?;
                require(room.covers(it.room))?;
                state.scope = it.in_turn;
            }
            Op::Pop { id } => {
                let it = program.loops.get(id.index())?;
                self.room_at_slot(state, program.attempt)?;
                self.widen(state.scope, it.in_turn)?;
                state.room = it.room;
                state.scope = it.between_turns;
            }
            Op::Turned { id, to } => {
                let it = program.loops.get(id.index())?;
                self.widen(state.scope, self.join(it.back_into_turn)?.scope)?;
                state.scope = it.between_turns;
                self.go(state, to)?;
            }
            Op::Retreat { id, none } => {
                let it = program.loops.get(id.index())?;
                self.widen(state.scope, it.between_turns)?;
                state.scope = self.kin[it.turns.scope.index()].base;
                self.go(state, none)?;
            }
            Op::Visit { site, seen } => {
                self.check_site(state, site)?;
                self.go(state, seen)?;
            }
            Op::VisitRun {
                direction,
                class,
                reserve,
                site,
                seen,
                ..
            } => {
                has_class(class)?;
                self.check_site(state, site)?;
                require(room.toward(direction) >= reserve)?;
                state.room = room.with(direction, reserve);
                self.go(state, seen)?;
            }
            Op::EnterLook { .. } | Op::LeaveLook { .. } | Op::DoubtVisit => {
                require(program.purpose == Purpose::Memoizing)?;
            }
            Op::Mark { slot } => require(self.enter(&mut state, slot)? == ScopeKind::Mark)?,
            Op::Cut { slot } => {
                require(self.read(state, slot)? == ScopeKind::Mark)?;
                state.scope = slot.scope;
            }
        }
        Some(state)
    }

    fn choose(&self, state: State, slot: Slot, index: u32, target: Target) -> Option<()> {
        let ScopeKind::Choice { has_frames, .. } = self.kind_of(slot)? else {
            return None;
        };
        require(self.program.choice_targets(slot).get(index as usize) == Some(&target))?;
        let choice = self.scope(slot.scope)?;
        let base = self.kin[slot.scope.index()].base;
        require(self.encloses(base, state.scope))?;
        require(has_frames || self.widen(state.scope, base).is_some())?;
        let resumed = self.join(target)?.scope;
        self.widen(state.scope, resumed)?;
        require(self.encloses(choice.parent, resumed) || self.encloses(resumed, base))?;
        require(!self.encloses(slot.scope, resumed))?;
        require(self.scope(resumed)?.height <= choice.height)
    }
}

fn relate_scopes(program: &Program, kin: &mut Vec<Kin>) -> Option<()> {
    let scopes = &program.scopes;
    let root = scopes.first()?;
    require(root.kind == ScopeKind::Root && root.height == 0 && root.parent == ROOT)?;
    let of_root = Kin {
        last_descendant: 0,
        descendants: 0,
        base: ROOT,
        stack: ROOT,
        has_choice: false,
    };
    fill(kin, scopes.len(), of_root).ok()?;
    for (index, scope) in scopes.iter().enumerate().skip(1) {
        require(scope.parent.index() < index)?;
        let (id, parent) = (ScopeId(index as u32), &scopes[scope.parent.index()]);
        require(scope.height as usize <= program.cell_count())?;
        let cells = scope.height.checked_sub(parent.height)?;
        let is_of_loop = |id: LoopId| parent.kind == ScopeKind::Turns(id);
        let tells_stack = match scope.kind {
            ScopeKind::Root => return None,
            ScopeKind::Position(room) => {
                require(cells == 1 && room.ahead <= MAX_LENGTH && room.behind <= MAX_LENGTH)?;
                false
            }
            ScopeKind::Numbers => false,
            ScopeKind::Mark | ScopeKind::Reserved => {
                require(cells == 1)?;
                false
            }
            ScopeKind::Choice {
                first_target,
                end_target,
                has_frames,
            } => {
                require(parent.kind == ScopeKind::Reserved && first_target < end_target)?;
                require(end_target as usize <= program.choice_targets.len())?;
                let reservation = &mut kin[scope.parent.index()];
                require(!core::mem::replace(&mut reservation.has_choice, true))?;
                has_frames
            }
            ScopeKind::Turns(it) => {
                require(cells == 1 && program.loops.get(it.index())?.turns.scope == id)?;
                false
            }
            ScopeKind::InTurn(it) => {
                require(cells == 0 && is_of_loop(it) && program.loops[it.index()].in_turn == id)?;
                true
            }
            ScopeKind::BetweenTurns(it) => {
                require(is_of_loop(it) && program.loops[it.index()].between_turns == id)?;
                true
            }
        };
        require(tells_stack || !matches!(parent.kind, ScopeKind::Turns(_)))?;
        let above = kin[scope.parent.index()];
        kin[index] = Kin {
            last_descendant: id.0,
            descendants: 0,
            base: match parent.kind {
                ScopeKind::Reserved => above.base,
                _ => scope.parent,
            },
            stack: if tells_stack { id } else { above.stack },
            has_choice: false,
        };
    }
    for index in (0..scopes.len()).rev() {
        let own = kin[index];
        require(own.last_descendant - index as u32 == own.descendants)?;
        if index != 0 {
            let parent = &mut kin[scopes[index].parent.index()];
            parent.last_descendant = parent.last_descendant.max(own.last_descendant);
            parent.descendants += own.descendants + 1;
        }
    }
    Some(())
}
