//! Removes loads of what is at hand, stores of what is there already, stores that are overwritten unseen, and nodes
//! that would find what they found before.

use core::hash::BuildHasher;
use core::ops::Range;

use bun_engine_asm::{Sign, Size};

use super::Analyses;
use super::dead_stores::remove_dead_stores;
use super::merges::Merges;
use super::places::{Address, Place};
use super::preheaders::entering_edges;
use super::readability::{is_held, withdraw_promises};
use super::writes::Writes;
use crate::analysis::{Cfg, Dominators, Loop};
use crate::ir::{
    AccessFlags, Block, Builder, EffectFlags, Effects, Function, Lanes, Load, Op, Store, Table,
    Type, Unary, Value, entities,
};
use crate::target::Target;

const MOST_WRITES_COMPARED: u32 = 32;
const MOST_SIGHTINGS_SEARCHED: usize = 24;
const MOST_WAYS_JOINED: usize = 8;
const MOST_NESTED_JOINS: u32 = 2;
const MOST_LOADS_WAITING_PER_LOOP: u32 = 16;
/// The widest value that pieces are put together from, in bytes.
const GREATEST_PIECE: u32 = 8;

entities! {
    Location = "location";
    Sighting = "sighting";
}

/// In a block, after this many writes of the function.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Point {
    block: Block,
    time: u32,
}

/// What a location held at a point.
#[derive(Clone, Copy)]
struct SightingData {
    at: Point,
    /// Its low `size` bytes are those in memory.
    value: Value,
    size: u32,
    /// The load that gives exactly the value.
    exact: Option<Load>,
    was_stored: bool,
    is_immutable: bool,
    earlier: Sighting,
    /// The last of the earlier ones that dominates this one.
    outer: Sighting,
}

#[derive(Clone, Copy)]
enum Key {
    /// Loads that rearrange the bytes match only their like.
    Memory(Address, Option<Load>),
    /// The first of its like.
    Node(Value),
}

struct LocationData {
    key: Key,
    latest: Sighting,
    /// The one that dominates the current point last is this or further out.
    innermost: Sighting,
}

/// What a load wants. A node counts as a full load of no bytes.
#[derive(Clone, Copy)]
struct Wanted {
    load: Value,
    kind: Load,
    place: Option<Place>,
    location: Location,
    groups: u64,
}

impl Wanted {
    fn size(&self) -> u32 {
        self.place.map_or(0, |place| place.size)
    }
}

/// To bring the value to the load through parameters.
#[derive(Clone, Copy)]
struct Attempt<'a> {
    wanted: &'a Wanted,
    outermost: Block,
    /// Otherwise it only finds out whether it would succeed.
    acts: bool,
}

enum Change {
    None,
    /// There is none after the start of this block.
    OnTheWayTo(Block),
    Other,
}

/// A load that could be a parameter of the header of a loop, whose turns have not been seen to the end.
struct Waiting {
    wanted: Wanted,
    earlier: u32,
}

#[derive(Clone, Copy)]
struct LoopState {
    returns_unseen: u32,
    waiting: u32,
    last_waiting: u32,
}

struct Elimination<'a> {
    cfg: &'a Cfg,
    dominators: &'a Dominators,
    writes: Writes,
    merges: Merges<'a>,
    /// An open hash table.
    by_key: Vec<Location>,
    locations: Table<Location, LocationData>,
    sightings: Table<Sighting, SightingData>,
    loops: Table<Loop, LoopState>,
    waiting: Vec<Waiting>,
    made_aliases: bool,
    /// By values that are at hand in more places.
    replaced: Vec<Value>,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let (cfg, dominators) = analyses.dominators(function);
    let mut accesses = Vec::new();
    let mut accesses_in = function.block_table(0..0);
    let mut stores = function.block_table(0);
    let note = |value, effects: Effects, time| {
        let op = function.op(value);
        let is_store = matches!(op, Op::Store { .. });
        let is_wanted = match op {
            Op::Load { .. } => !effects.has(EffectFlags::FENCE),
            Op::Store { .. } => !effects.has(EffectFlags::FENCE) && effects.writes_memory(),
            Op::Node { .. } | Op::WideNode { .. } => effects.at_most_exits(),
            _ => false,
        };
        if is_wanted {
            let (block, number) = (function.block_of(value), accesses.len());
            let range: &mut Range<usize> = &mut accesses_in[block];
            *range = if range.end == 0 { number } else { range.start }..number + 1;
            accesses.push((value, time));
            stores[block] += u32::from(is_store);
        }
    };
    let writes = Writes::collect(function, cfg, |_| true, note);
    if accesses.len() < 2 {
        return;
    }
    let mut merges = Merges::new(cfg, dominators);
    for rank in merges.all_ranks() {
        let numbers = writes.at_positions(rank - 1..rank);
        let groups = numbers.fold(0, |groups, number| groups | writes.group_of_write(number));
        merges.add_changes(rank, groups);
    }
    merges.compute(function, merges.all_ranks());
    let mut loops = Table::default();
    for id in cfg.loops().keys() {
        let ways = cfg.predecessors(cfg.loops()[id].header).len();
        loops.push(LoopState {
            returns_unseen: (ways - entering_edges(function, cfg, id).len()) as u32,
            waiting: 0,
            last_waiting: u32::MAX,
        });
    }
    let mut elimination = Elimination {
        cfg,
        dominators,
        writes,
        merges,
        by_key: vec![Location::NONE; (2 * accesses.len()).next_power_of_two()],
        locations: Table::default(),
        sightings: Table::default(),
        loops,
        waiting: Vec::new(),
        made_aliases: false,
        replaced: Vec::new(),
    };
    for &block in dominators.pre_order() {
        for &(value, time) in &accesses[accesses_in[block].clone()] {
            elimination.visit(function, value, Point { block, time });
        }
        elimination.finish_turns(function, block);
    }
    remove_dead_stores(function, cfg, &stores);
    if elimination.made_aliases {
        withdraw_promises(function, cfg, &elimination.replaced);
        function.resolve_aliases();
    }
}

fn hash_of(function: &Function, key: Key) -> u64 {
    let seed = function.seed();
    match key {
        Key::Memory(address, special) => seed.hash_one((address, special)),
        Key::Node(node) => {
            let (op, ty) = (function.op(node), function.type_of(node));
            seed.hash_one((op.node(), ty, function.operands(node)))
        }
    }
}

/// Zero extended to `ty`, which is as wide or wider.
fn keep_low_bytes(builder: &mut Builder<'_>, value: Value, bytes: u32, ty: Type) -> Value {
    let mut value = value;
    if builder.type_of(value).width() > ty.width() {
        value = builder.wrap(value);
    }
    if bytes < builder.type_of(value).bytes() {
        value = builder.and(value, (1i64 << (8 * bytes)) - 1);
    }
    if builder.type_of(value).width() < ty.width() {
        value = builder.zero_extend(value);
    }
    value
}

impl SightingData {
    fn supplies(&self, function: &Function, wanted: &Wanted) -> bool {
        let (has, wants) = (function.type_of(self.value), function.type_of(wanted.load));
        self.exact == Some(wanted.kind) && has == wants
            || has != Type::V128 && self.size >= wanted.size()
    }

    fn convert(&self, function: &mut Function, wanted: &Wanted, before: Value) -> Value {
        let (mut value, ty) = (function.resolve(self.value), function.type_of(wanted.load));
        if self.exact == Some(wanted.kind) && function.type_of(value) == ty {
            return value;
        }
        let origin = function.origin(wanted.load);
        let mut builder = Builder::before(function, before);
        builder.origin = origin;
        if builder.type_of(value).is_float() {
            value = builder.bitcast(value);
        }
        if builder.type_of(value).width() > ty.width() {
            value = builder.wrap(value);
        }
        match wanted.kind {
            Load::Narrow(size, Sign::Signed) => builder.unary(Unary::SignExtend(size), value),
            Load::Narrow(size, Sign::Unsigned) => builder.and(value, (1 << size.bits()) - 1),
            _ if ty.is_float() => builder.bitcast(value),
            _ => value,
        }
    }

    fn has_low_bytes_of(&self, function: &Function, value: Value, size: u32) -> bool {
        let known = function.resolve(self.value);
        let constants = (function.constant_bits(known), function.constant_bits(value));
        self.size >= size
            && match constants {
                (Some(a), Some(b)) => (a ^ b) << (u64::BITS - 8 * size) == 0,
                _ => known == value,
            }
    }
}

impl Elimination<'_> {
    fn visit(&mut self, function: &mut Function, value: Value, at: Point) {
        let place = Place::of(function, value);
        match (*function.op(value), place) {
            (Op::Load { kind, access, .. }, Some(Place { address, .. })) => {
                let is_plain = matches!(kind, Load::Full | Load::Narrow(..));
                let key = Key::Memory(address, (!is_plain).then_some(kind));
                let wanted = Wanted {
                    load: value,
                    kind,
                    place,
                    location: self.location(function, key),
                    groups: self.writes.groups_overlapping(function, access.heap()),
                };
                self.visit_load(function, &wanted, at);
            }
            (
                Op::Store {
                    kind,
                    args: [stored, _],
                    access,
                    ..
                },
                Some(place),
            ) => {
                let stored = function.resolve(stored);
                let location = self.location(function, Key::Memory(place.address, None));
                let groups = self.writes.groups_overlapping(function, access.heap());
                if let Some(known) = self.dominating(location, at.block)
                    && known.has_low_bytes_of(function, stored, place.size)
                    && (known.was_stored || !access.has(AccessFlags::TRAPS))
                    && let Change::None = self.change(function, known.at, at, Some(&place), groups)
                {
                    return function.remove(value);
                }
                let sighting = SightingData {
                    at: Point {
                        time: at.time + 1,
                        ..at
                    },
                    value: stored,
                    size: place.size,
                    exact: (kind == Store::Full).then_some(Load::Full),
                    was_stored: true,
                    is_immutable: false,
                    earlier: Sighting::NONE,
                    outer: Sighting::NONE,
                };
                self.add_sighting(location, sighting);
            }
            _ => {
                function.resolve_operands(value);
                let reads = function.effects(value).reads;
                let wanted = Wanted {
                    load: value,
                    kind: Load::Full,
                    place,
                    location: self.location(function, Key::Node(value)),
                    groups: self.writes.groups_overlapping(function, reads),
                };
                self.visit_load(function, &wanted, at);
            }
        }
    }

    fn visit_load(&mut self, function: &mut Function, wanted: &Wanted, at: Point) {
        let access = function.op(wanted.load).access();
        let mut sighting = SightingData {
            at,
            value: wanted.load,
            size: wanted.size(),
            exact: Some(wanted.kind),
            was_stored: false,
            is_immutable: access.is_some_and(|access| access.has(AccessFlags::IMMUTABLE)),
            earlier: Sighting::NONE,
            outer: Sighting::NONE,
        };
        let mut join = None;
        if let Some(known) = self.dominating(wanted.location, at.block)
            && known.supplies(function, wanted)
        {
            match self.change_since(function, &known, at, wanted) {
                Change::None => {
                    sighting.value = known.convert(function, wanted, wanted.load);
                    sighting.was_stored = known.was_stored;
                    self.replace(function, wanted.load, sighting.value, !known.was_stored);
                    let is_fresher = known.at != at && known.size == sighting.size;
                    if !known.is_immutable && (sighting.is_immutable || is_fresher) {
                        self.add_sighting(wanted.location, sighting);
                    }
                    return;
                }
                Change::OnTheWayTo(block) => join = Some(block),
                Change::Other => {}
            }
        }
        if let Some(value) = self.find_in_pieces(function, wanted, at) {
            sighting.value = value;
            self.replace(function, wanted.load, value, false);
            self.add_sighting(wanted.location, sighting);
            return;
        }
        if let Some(join) = join.or_else(|| self.join_after_sighting(function, wanted, at)) {
            match self.cfg.loop_headed_by(join) {
                Some(headed) if self.loops[headed].returns_unseen != 0 => {
                    self.wait_for_turns(wanted, headed);
                }
                _ => self.try_to_join_values(function, wanted, join),
            }
        }
        self.add_sighting(wanted.location, sighting);
    }

    /// What memory holds at the place, while a sighting that dominates says so.
    fn held_at(
        &mut self,
        function: &Function,
        wanted: &Wanted,
        place: Place,
        at: Point,
    ) -> Option<Value> {
        let location = self.find_location(function, place.address)?;
        let known = self.dominating(location, at.block)?;
        if known.size < place.size || function.type_of(known.value) == Type::V128 {
            return None;
        }
        let piece = Wanted {
            place: Some(place),
            location,
            ..*wanted
        };
        let unchanged = matches!(
            self.change_since(function, &known, at, &piece),
            Change::None
        );
        unchanged.then(|| function.resolve(known.value))
    }

    /// Of a wider value that memory holds, or of the two halves of the place.
    fn find_in_pieces(
        &mut self,
        function: &mut Function,
        wanted: &Wanted,
        at: Point,
    ) -> Option<Value> {
        let want = wanted.place?;
        let ty = function.type_of(wanted.load);
        let bytes = want.size;
        if !matches!(wanted.kind, Load::Full | Load::Narrow(..)) {
            return None;
        }
        if ty == Type::V128 {
            return self.find_lanes(function, wanted, want, at);
        }
        if bytes > GREATEST_PIECE {
            return None;
        }
        for distance in (bytes..=GREATEST_PIECE - bytes).step_by(bytes as usize) {
            let wider = want.at_distance(-i64::from(distance), distance + bytes)?;
            if let Some(value) = self.held_at(function, wanted, wider, at) {
                return Some(self.put_together(function, wanted, &[(value, distance)], ty));
            }
        }
        let half = bytes / 2;
        if half == 0 || !half.is_power_of_two() {
            return None;
        }
        let places = [
            want.at_distance(0, half)?,
            want.at_distance(half.into(), half)?,
        ];
        let [low, high] = places.map(|place| self.held_at(function, wanted, place, at));
        let halves = [(low?, 0), (high?, 0)];
        Some(self.put_together(function, wanted, &halves, ty))
    }

    /// Both halves of a vector, each as wide as a word.
    fn find_lanes(
        &mut self,
        function: &mut Function,
        wanted: &Wanted,
        want: Place,
        at: Point,
    ) -> Option<Value> {
        let half = want.size / 2;
        if half != GREATEST_PIECE {
            return None;
        }
        let places = [
            want.at_distance(0, half)?,
            want.at_distance(half.into(), half)?,
        ];
        let [low, high] = places.map(|place| self.held_at(function, wanted, place, at));
        let (low, high) = (low?, high?);
        let lanes = Lanes::Int(Size::S64);
        let origin = function.origin(wanted.load);
        let mut builder = Builder::before(function, wanted.load);
        builder.origin = origin;
        let [low, high] = [low, high].map(|value| match builder.type_of(value).is_float() {
            true => builder.bitcast(value),
            false => value,
        });
        let vector = builder.splat(lanes, low);
        Some(builder.replace_lane(lanes, vector, 1, high))
    }

    /// The pieces, each with how many of its low bytes to leave out, one after the other from the low end.
    fn put_together(
        &mut self,
        function: &mut Function,
        wanted: &Wanted,
        pieces: &[(Value, u32)],
        ty: Type,
    ) -> Value {
        let origin = function.origin(wanted.load);
        let mut builder = Builder::before(function, wanted.load);
        builder.origin = origin;
        let bytes = wanted.size() / pieces.len() as u32;
        let integer = Type::from(ty.width());
        let mut result = Value::NONE;
        for (position, &(piece, left_out)) in pieces.iter().enumerate() {
            let mut value = piece;
            if builder.type_of(value).is_float() {
                value = builder.bitcast(value);
            }
            if left_out != 0 {
                value = builder.shr(value, (8 * left_out) as i32);
            }
            value = keep_low_bytes(&mut builder, value, bytes, integer);
            if position != 0 {
                value = builder.shl(value, (8 * bytes * position as u32) as i32);
                value = builder.or(result, value);
            }
            result = value;
        }
        match wanted.kind {
            Load::Narrow(size, Sign::Signed) => builder.unary(Unary::SignExtend(size), result),
            _ if ty.is_float() => builder.bitcast(result),
            _ => result,
        }
    }

    fn replace(&mut self, function: &mut Function, load: Value, value: Value, is_like: bool) {
        if function.type_of(load) == Type::Void {
            return function.remove(load);
        }
        if !is_like || is_held(function.effects(load)) {
            self.replaced.push(load);
        }
        function.replace(load, value);
        self.made_aliases = true;
    }

    // Locations and sightings

    fn location(&mut self, function: &Function, key: Key) -> Location {
        let of_node = |node| {
            let (op, ty) = (function.op(node), function.type_of(node));
            (op.node(), ty, function.operands(node))
        };
        let mask = self.by_key.len() - 1;
        let mut slot = hash_of(function, key) as usize & mask;
        while let Some(known) = self.by_key[slot].expand() {
            let is_same = match (self.locations[known].key, key) {
                (Key::Memory(a, b), Key::Memory(c, d)) => (a, b) == (c, d),
                (Key::Node(a), Key::Node(b)) => of_node(a) == of_node(b),
                _ => false,
            };
            if is_same {
                return known;
            }
            slot = (slot + 1) & mask;
        }
        self.by_key[slot] = self.locations.push(LocationData {
            key,
            latest: Sighting::NONE,
            innermost: Sighting::NONE,
        });
        self.by_key[slot]
    }

    /// Without making one for an address that has none.
    fn find_location(&self, function: &Function, address: Address) -> Option<Location> {
        let key = Key::Memory(address, None);
        let mask = self.by_key.len() - 1;
        let mut slot = hash_of(function, key) as usize & mask;
        while let Some(known) = self.by_key[slot].expand() {
            if let (Key::Memory(a, b), Key::Memory(c, d)) = (self.locations[known].key, key)
                && (a, b) == (c, d)
            {
                return Some(known);
            }
            slot = (slot + 1) & mask;
        }
        None
    }

    /// For the current block.
    fn dominating(&mut self, location: Location, block: Block) -> Option<SightingData> {
        let innermost = &mut self.locations[location].innermost;
        while let Some(known) = innermost.expand() {
            let data = self.sightings[known];
            if self.dominators.dominates(data.at.block, block) {
                return Some(data);
            }
            *innermost = data.outer;
        }
        None
    }

    /// In the current block, after `dominating`.
    fn add_sighting(&mut self, location: Location, sighting: SightingData) {
        let data = &mut self.locations[location];
        data.latest = self.sightings.push(SightingData {
            earlier: data.latest,
            outer: data.innermost,
            ..sighting
        });
        data.innermost = data.latest;
    }

    fn recent_sightings(&self, location: Location) -> impl Iterator<Item = &SightingData> {
        let get = |known: Sighting| Some(&self.sightings[known.expand()?]);
        core::iter::successors(get(self.locations[location].latest), move |data| {
            get(data.earlier)
        })
        .take(MOST_SIGHTINGS_SEARCHED)
    }

    // Changes

    fn writes_in(&self, block: Block) -> Range<u32> {
        let position = self.cfg.position(block);
        self.writes.at_positions(position..position + 1)
    }

    /// Includes those between the end of the nearest dominator and the start of the block.
    fn writes_on_the_way_to(&self, block: Block) -> Range<u32> {
        let (loops, position) = (self.cfg.loops(), self.cfg.position(block));
        let (start, mut end) = (self.merges.parent(position + 1), position);
        let mut around = self.cfg.loop_of(block);
        while !around.is_none() && loops[around].positions().start >= start {
            (end, around) = (loops[around].positions().end, loops[around].parent);
        }
        self.writes.at_positions(start..end)
    }

    fn change_since(
        &self,
        function: &Function,
        known: &SightingData,
        to: Point,
        wanted: &Wanted,
    ) -> Change {
        if known.is_immutable {
            return Change::None;
        }
        self.change(function, known.at, to, wanted.place.as_ref(), wanted.groups)
    }

    /// The last that may come between the points, of which the first dominates the second.
    fn change(
        &self,
        function: &Function,
        from: Point,
        mut to: Point,
        place: Option<&Place>,
        groups: u64,
    ) -> Change {
        let mut patience = MOST_WRITES_COMPARED;
        let mut may_change = |numbers| {
            self.writes
                .may_change(function, numbers, place, groups, &mut patience)
        };
        let first = self.merges.rank(from.block);
        while to.block != from.block {
            let rank = self.merges.rank(to.block);
            if self.merges.changed_in(rank) & groups != 0
                && may_change(self.writes_in(to.block).start..to.time)
            {
                return Change::Other;
            }
            if self.merges.merged_at(rank) & groups != 0
                && may_change(self.writes_on_the_way_to(to.block))
            {
                return Change::OnTheWayTo(to.block);
            }
            let above = self
                .merges
                .last_change(self.merges.parent(rank), groups, first);
            if above < first {
                return Change::None;
            }
            to = self.end_of(self.merges.block(above));
        }
        if may_change(from.time..to.time) {
            Change::Other
        } else {
            Change::None
        }
    }

    fn end_of(&self, block: Block) -> Point {
        Point {
            block,
            time: self.writes_in(block).end,
        }
    }

    // Values that come by several ways

    /// A block in which ways meet, one of which may have the value, with no change from its start to the point.
    fn join_after_sighting(
        &self,
        function: &Function,
        wanted: &Wanted,
        at: Point,
    ) -> Option<Block> {
        let position = self.cfg.position(at.block);
        let aside = self.recent_sightings(wanted.location).find(|known| {
            !self.dominators.dominates(known.at.block, at.block)
                && self.cfg.position(known.at.block) < position
        })?;
        let fork = self.dominators.common_dominator(aside.at.block, at.block);
        let top = fork.map_or(0, |fork| self.merges.rank(fork));
        let block = self
            .merges
            .block(self.merges.first_dominator_after(top, position + 1));
        let start = Point {
            block,
            time: self.writes_in(block).start,
        };
        let change = self.change(function, start, at, wanted.place.as_ref(), wanted.groups);
        matches!(change, Change::None).then_some(block)
    }

    /// Replaces the load with a new parameter of the block. What it is computed from comes before that, since it comes
    /// before an earlier sighting.
    fn try_to_join_values(&mut self, function: &mut Function, wanted: &Wanted, join: Block) {
        let ty = function.type_of(wanted.load);
        let mut attempt = Attempt {
            wanted,
            outermost: join,
            acts: false,
        };
        if ty == Type::Tuple || self.join_values(function, attempt, join, 0).is_none() {
            return;
        }
        let mut param = Value::NONE;
        if ty != Type::Void {
            attempt.acts = true;
            let joined = self.join_values(function, attempt, join, 0);
            param = joined.expect("it was found to be possible");
        }
        self.replace(function, wanted.load, param, false);
    }

    fn join_values(
        &self,
        function: &mut Function,
        attempt: Attempt<'_>,
        join: Block,
        depth: u32,
    ) -> Option<Value> {
        let ways = self.cfg.predecessors(join);
        if !(2..=MOST_WAYS_JOINED).contains(&ways.len()) {
            return None;
        }
        for &edge in ways {
            let arg = self.value_at_end(function, attempt, function.source(edge), depth)?;
            if attempt.acts {
                function.push_arg(edge, arg);
            }
        }
        Some(if attempt.acts {
            function.add_param(join, function.type_of(attempt.wanted.load))
        } else {
            Value::NONE
        })
    }

    fn value_at_end(
        &self,
        function: &mut Function,
        attempt: Attempt<'_>,
        block: Block,
        depth: u32,
    ) -> Option<Value> {
        let (wanted, end) = (attempt.wanted, self.end_of(block));
        let known = self
            .recent_sightings(wanted.location)
            .find(|known| self.dominators.dominates(known.at.block, block))
            .filter(|known| known.supplies(function, wanted))
            .map(|known| (known, self.change_since(function, known, end, wanted)));
        let join = match known {
            Some((known, Change::None)) if attempt.acts => {
                return Some(known.convert(function, wanted, function.last(block)));
            }
            Some((_, Change::None)) => return Some(Value::NONE),
            Some((_, Change::OnTheWayTo(join))) => join,
            _ => self.join_after_sighting(function, wanted, end)?,
        };
        if join == attempt.outermost {
            // This turn of the loop leaves the value as it was, and the load is about to stand for that.
            return Some(wanted.load);
        }
        if depth == MOST_NESTED_JOINS || self.cfg.loop_headed_by(join).is_some() {
            return None;
        }
        self.join_values(function, attempt, join, depth + 1)
    }

    fn wait_for_turns(&mut self, wanted: &Wanted, headed: Loop) {
        let state = &mut self.loops[headed];
        if state.waiting < MOST_LOADS_WAITING_PER_LOOP {
            state.waiting += 1;
            let earlier = core::mem::replace(&mut state.last_waiting, self.waiting.len() as u32);
            self.waiting.push(Waiting {
                wanted: *wanted,
                earlier,
            });
        }
    }

    fn finish_turns(&mut self, function: &mut Function, block: Block) {
        if self.cfg.loop_of(block).is_none() {
            return;
        }
        for edge in function.successors(block) {
            if !self.cfg.is_backward(function, edge) {
                continue;
            }
            let header = function.target(edge);
            let state = &mut self.loops[self.cfg.loop_of(header)];
            state.returns_unseen -= 1;
            if state.returns_unseen != 0 {
                continue;
            }
            let mut next = state.last_waiting;
            while let Some(&Waiting { wanted, earlier }) = self.waiting.get(next as usize) {
                self.try_to_join_values(function, &wanted, header);
                next = earlier;
            }
        }
    }
}
