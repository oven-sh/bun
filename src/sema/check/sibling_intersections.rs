//! Reuses work between the intersections of a cross product.
//!
//! `X & (A | B) & (C | D)` is a union of four intersections that share most of their members
//! (`getCrossProductIntersections`). `getReducedType` reduces each of them, and for each one it combines the properties
//! that several members have, which computes the type of every such property again. MUI's
//! `ComponentsPropsList[keyof ComponentsPropsList]` as an assignment target is a union of 81 intersections. Each has
//! 398 members, in which 46,000 properties share 870 names.
//!
//! So while `reduced_members` filters a union, `combine_props` caches what it learned about each property of each
//! member (`Fact`) and reads that instead of recomputing it.
//!
//! tsgo recomputes, so skipping the calls must not be observable. The rules are the same as in check/infer_traces.rs:
//!
//! - A fact is about one property under one mapper. The calls it replaces have no other input.
//! - A call's result is cached only if the call left no trace (`Checker::traces_of_inference`), so all its lookups hit
//!   the type store or a table. It also didn't taint a frame or call `Task::hold_back`.
//! - The effects such a call has every time it runs are recorded and replayed. See `Effects`.
//! - The next cycle or limit invalidates the facts (`disturbances_for_siblings`). A lookup that misses without starting
//!   an evaluation only gets a different answer later if a cycle or a limit produced the new entry. If this task itself
//!   hit the cycle or the limit, it stops using facts until the next union. A property type that depends on a query in
//!   progress hits the cycle on every request, so no fact would live long enough to be read.
//! - No instantiation is in progress (`Checker::may_reuse_for_siblings`). While a mapper is active, `instantiate`
//!   counts a type only once.
//! - The facts live only while `reduced_members` filters one union. Anything that was in progress when a fact was
//!   cached is still in progress when it's read. A reduction takes the facts out of the checker while it uses them, so
//!   nested reductions, which have more in progress, don't find them.
//!
//! The facts belong to one `Checker`. No other task sees them.

use super::super::infer::COMMITS;
use super::super::instantiate::PropInstantiation;
use super::super::*;
use super::{Members, PropOfConstituent};

/// A member of an intersection that has a property, and the property.
pub(super) type Holder<'p> = (Members<'p>, &'p Prop<'p>);

/// The side effects a call has every time it runs.
#[derive(Copy, Clone)]
enum Effects {
    /// The call hasn't run yet, or it left a trace.
    Unknown,
    Known {
        /// Bytes of native stack it uses.
        stack: u16,
        /// Amount it adds to `Checker::instantiation_count`.
        instantiations: u16,
        /// Bits it sets in `Checker::reliability`.
        reliability: u8,
    },
}

/// A property's type, and what `combine_props` needs to know about it.
#[derive(Copy, Clone)]
pub(super) struct TypeOfProp {
    pub(super) ty: TypeId,
    /// `isLiteralType`, `isPatternLiteralType`
    pub(super) is_literal: bool,
}

/// The facts `combine_props` has learned about one property of one member. It reads one `Fact` for each property of
/// each intersection, so a `Fact` is kept to half a cache line.
#[derive(Copy, Clone)]
#[repr(align(32))]
struct Fact {
    /// The result of `instantiation_of_prop`.
    instantiation: PropInstantiation,
    instantiation_effects: Effects,
    /// The first type `types_of_instantiated_prop` returns.
    ty: TypeId,
    type_effects: Effects,
    /// 1 + the `PropOfConstituent`'s number, or 0 if it has no number yet.
    symbol: u32,
    /// `SiblingIntersections::generation` when the calls ran. In any other generation their effects are unknown.
    generation: u16,
    /// `TypeOfProp::is_literal`
    is_literal: bool,
}

const _: () = assert!(size_of::<Fact>() == 32);

impl Fact {
    const NONE: Fact = Fact {
        instantiation: PropInstantiation::Type(TypeId::NEVER),
        instantiation_effects: Effects::Unknown,
        ty: TypeId::NEVER,
        type_effects: Effects::Unknown,
        symbol: 0,
        generation: 0,
        is_literal: false,
    };
}

type Disturbances = [u64; 9];

#[derive(Default)]
pub(in super::super) struct SiblingIntersections<'p> {
    /// A number for each distinct `Members`, keyed by its shape's address and its mapper.
    members: FxHashMap<(usize, MapperId), u32>,
    /// For each number, a fact for each property of the shape.
    facts: Vec<Box<[Fact]>>,
    /// A number for each distinct property under a mapper.
    symbols: FxHashMap<PropOfConstituent<'p>, u32>,
    /// For each entry of `symbols`, the last `name` for which `combine_props` saw it.
    seen_for: Vec<u32>,
    /// Counts calls to `combine_props`.
    name: u32,
    /// `disturbances_for_siblings` at the start of this generation.
    disturbances: Disturbances,
    /// Counts the commits that invalidated facts.
    generation: u16,
    /// This task has hit a cycle or a limit since the facts were created.
    is_abandoned: bool,
}

impl<'p> SiblingIntersections<'p> {
    /// Returns the number of each element of `all`.
    pub(super) fn numbers_of(&mut self, all: &[Members]) -> Vec<u32> {
        let mut number_of = |it: &Members| {
            let shape = std::ptr::from_ref(it.resolved).addr();
            let next = self.facts.len() as u32;
            let number = *self.members.entry((shape, it.mapper)).or_insert(next);
            if number == next {
                let facts = vec![Fact::NONE; it.shape().props.len()];
                self.facts.push(facts.into_boxed_slice());
            }
            number
        };
        all.iter().map(&mut number_of).collect()
    }

    /// Invalidates the results cached so far. The numbers stay, because they don't depend on types.
    fn begin_generation(&mut self, disturbances: &Disturbances) {
        self.disturbances = *disturbances;
        self.generation = self.generation.wrapping_add(1);
        // After a wraparound, facts from 65,536 generations ago would look current.
        if self.generation == 0 {
            for fact in self.facts.iter_mut().flat_map(|it| it.iter_mut()) {
                (fact.instantiation_effects, fact.type_effects) =
                    (Effects::Unknown, Effects::Unknown);
            }
        }
    }
}

/// The facts, and where to find the ones for the properties with one name.
pub(super) struct FactsOfName<'a, 'p> {
    all: &'a mut SiblingIntersections<'p>,
    /// `SiblingIntersections::numbers_of` for the intersection's members.
    numbers: &'a [u32],
    /// For each property: the index of its member in `numbers`, and its position in the member's shape.
    prop_locations: &'a [(u32, u32)],
}

impl<'a, 'p> FactsOfName<'a, 'p> {
    pub(super) fn new(
        all: &'a mut SiblingIntersections<'p>,
        numbers: &'a [u32],
        prop_locations: &'a [(u32, u32)],
    ) -> FactsOfName<'a, 'p> {
        all.name += 1;
        FactsOfName {
            all,
            numbers,
            prop_locations,
        }
    }

    /// `nth` is an index into `prop_locations`.
    #[inline]
    fn fact(&mut self, nth: usize) -> Option<&mut Fact> {
        let &(at, position) = self.prop_locations.get(nth)?;
        let &number = self.numbers.get(at as usize)?;
        let member_facts = self.all.facts.get_mut(number as usize)?;
        let fact = member_facts.get_mut(position as usize)?;
        if fact.generation != self.all.generation {
            fact.generation = self.all.generation;
            (fact.instantiation_effects, fact.type_effects) = (Effects::Unknown, Effects::Unknown);
        }
        Some(fact)
    }

    /// `propSet.Add`: returns false if an equal `symbol` was added since `new`. `nth` is the property's index in
    /// `prop_locations`.
    #[inline]
    pub(super) fn add_symbol(&mut self, nth: usize, symbol: PropOfConstituent<'p>) -> bool {
        let known = self.fact(nth).map_or(0, |it| it.symbol);
        let number = match known.checked_sub(1) {
            Some(number) => number,
            None => {
                let next = self.all.symbols.len() as u32;
                let number = *self.all.symbols.entry(symbol).or_insert(next);
                if number == next {
                    self.all.seen_for.push(0);
                }
                if let Some(fact) = self.fact(nth) {
                    fact.symbol = number + 1;
                }
                number
            }
        };
        let name = self.all.name;
        match self.all.seen_for.get_mut(number as usize) {
            Some(seen_for) => std::mem::replace(seen_for, name) != name,
            None => true,
        }
    }
}

/// Every value that a call leaving a trace would change.
#[derive(PartialEq, Eq)]
struct Readings {
    traces: [u64; 14],
    disturbances: Disturbances,
    held_back: u64,
    lowest_taint: usize,
}

/// The state of the checker before `run_for_a_fact` runs its call.
struct BeforeRun {
    readings: Readings,
    instantiation_count: u32,
    stack_in_use: usize,
    /// The bits the caller had set in `Checker::reliability`, which is cleared for the call.
    reliability: u8,
    /// `Checker::deepest_stack`, which is reset to 0 for the call.
    deepest_stack: usize,
}

impl<'p, 's> Checker<'p, 's> {
    /// True if a call whose lookups all hit would count the same instantiations if it ran again now.
    pub(super) fn may_reuse_for_siblings(&self) -> bool {
        self.instantiation_depth == 0
            && self.index_infos_in_instantiation.is_empty()
            && self.unresolved_members.is_empty()
    }

    /// `inference_disturbances`, except that other tasks' commits count only if they resolve a cycle. A task publishes
    /// what it computed in a cycle only in such a commit, and never publishes what it computed at a limit.
    fn disturbances_for_siblings(&self) -> Disturbances {
        let mut disturbances = self.inference_disturbances();
        disturbances[COMMITS] = self.newest_commit_with_a_cycle();
        disturbances
    }

    /// Returns empty facts, for a union that `reduced_members` is about to filter.
    pub(super) fn facts_for_siblings(&self) -> SiblingIntersections<'p> {
        SiblingIntersections {
            disturbances: self.disturbances_for_siblings(),
            ..Default::default()
        }
    }

    /// `now` is the current `disturbances_for_siblings`. Starts a new generation if only commits
    /// happened since the facts were cached, and gives the facts up if this task hit a cycle or a
    /// limit.
    fn note_disturbances(facts: &mut SiblingIntersections<'p>, now: &Disturbances) {
        if facts.disturbances == *now {
            return;
        }
        let mut after_commits_only = facts.disturbances;
        after_commits_only[COMMITS] = now[COMMITS];
        match after_commits_only == *now {
            true => facts.begin_generation(now),
            false => facts.is_abandoned = true,
        }
    }

    /// Call this before reading the facts. Returns false if they've been given up.
    pub(super) fn are_facts_usable(&self, facts: &mut SiblingIntersections<'p>) -> bool {
        Self::note_disturbances(facts, &self.disturbances_for_siblings());
        !facts.is_abandoned
    }

    fn readings_for_siblings(&self) -> Readings {
        Readings {
            traces: self.traces_of_inference(),
            disturbances: self.disturbances_for_siblings(),
            held_back: self.task.held_back(),
            lowest_taint: self.lowest_taint,
        }
    }

    /// Applies the effects of a cached call. Returns false and applies nothing if the effects are unknown, or if the
    /// count limit in `instantiate` or an `is_stack_low` check would have stopped the call.
    #[inline]
    fn replay(&mut self, effects: Effects) -> bool {
        let Effects::Known {
            stack,
            instantiations,
            reliability,
        } = effects
        else {
            return false;
        };
        let count = (self.instantiation_count).saturating_add(u32::from(instantiations));
        let in_use = self.stack_base.saturating_sub(stack_pointer());
        let deepest = in_use.saturating_add(stack as usize);
        if count >= 5_000_000 || deepest > self.stack_limit {
            return false;
        }
        self.instantiation_count = count;
        self.reliability |= reliability;
        if deepest > self.deepest_stack.get() {
            self.deepest_stack.set(deepest);
        }
        true
    }

    /// Runs `call` and returns its result and its effects, which are known if it left no trace. Records in `facts`
    /// whether it hit a cycle or a limit.
    fn run_for_a_fact<R>(
        &mut self,
        facts: &mut SiblingIntersections<'p>,
        call: impl FnOnce(&mut Self) -> R,
    ) -> (R, Effects) {
        let before = self.begin_run_for_a_fact();
        let result = call(self);
        (result, self.end_run_for_a_fact(facts, &before))
    }

    fn begin_run_for_a_fact(&mut self) -> BeforeRun {
        BeforeRun {
            readings: self.readings_for_siblings(),
            instantiation_count: self.instantiation_count,
            stack_in_use: self.stack_base.saturating_sub(stack_pointer()),
            reliability: std::mem::take(&mut self.reliability),
            deepest_stack: self.deepest_stack.replace(0),
        }
    }

    /// See `run_for_a_fact`.
    fn end_run_for_a_fact(
        &mut self,
        facts: &mut SiblingIntersections<'p>,
        before: &BeforeRun,
    ) -> Effects {
        let deepest = self.deepest_stack.get();
        self.deepest_stack.set(deepest.max(before.deepest_stack));
        let reliability = self.reliability;
        self.reliability |= before.reliability;
        let after = self.readings_for_siblings();
        Self::note_disturbances(facts, &after.disturbances);
        let stack = u16::try_from(deepest.saturating_sub(before.stack_in_use));
        let instantiations = (self.instantiation_count).checked_sub(before.instantiation_count);
        let instantiations = instantiations.and_then(|it| u16::try_from(it).ok());
        match (stack, instantiations) {
            (Ok(stack), Some(instantiations)) if after == before.readings => Effects::Known {
                stack,
                instantiations,
                reliability,
            },
            _ => Effects::Unknown,
        }
    }

    /// `instantiation_of_prop(prop, mapper)`. `nth` is the property's index in `facts`.
    pub(super) fn instantiation_of_prop_with_facts(
        &mut self,
        facts: Option<&mut FactsOfName<'_, 'p>>,
        nth: usize,
        prop: &Prop,
        mapper: MapperId,
    ) -> PropInstantiation {
        let Some(facts) = facts.filter(|it| !it.all.is_abandoned) else {
            return self.instantiation_of_prop(prop, mapper);
        };
        if let Some(&mut fact) = facts.fact(nth)
            && self.replay(fact.instantiation_effects)
        {
            return fact.instantiation;
        }
        let (instantiation, effects) =
            self.run_for_a_fact(facts.all, |c| c.instantiation_of_prop(prop, mapper));
        if let Some(fact) = facts.fact(nth) {
            (fact.instantiation, fact.instantiation_effects) = (instantiation, effects);
        }
        instantiation
    }

    /// The first type that `types_of_instantiated_prop(prop, instantiation)` returns. `nth` is the property's index in
    /// `facts`. `instantiation` is what `instantiation_of_prop_with_facts` returned for it, or `None` under the
    /// identity mapper.
    pub(super) fn type_of_prop_with_facts(
        &mut self,
        facts: Option<&mut FactsOfName<'_, 'p>>,
        nth: usize,
        prop: &Prop,
        instantiation: Option<PropInstantiation>,
    ) -> TypeOfProp {
        let compute = |c: &mut Self| {
            let (ty, _) = c.types_of_instantiated_prop(prop, instantiation);
            let is_literal =
                c.is_boolean(ty) || c.is_pattern_literal(ty) || c.is_every_type_unit(ty);
            TypeOfProp { ty, is_literal }
        };
        let Some(facts) = facts.filter(|it| !it.all.is_abandoned) else {
            return compute(self);
        };
        if let Some(&mut fact) = facts.fact(nth)
            && self.replay(fact.type_effects)
        {
            return TypeOfProp {
                ty: fact.ty,
                is_literal: fact.is_literal,
            };
        }
        let (found, effects) = self.run_for_a_fact(facts.all, compute);
        if let Some(fact) = facts.fact(nth) {
            (fact.ty, fact.type_effects) = (found.ty, effects);
            fact.is_literal = found.is_literal;
        }
        found
    }
}
