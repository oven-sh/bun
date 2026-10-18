//! Whether an intersection reduces to `never`: what is kept from one intersection to the next.
//!
//! `getReducedType` keeps its answer on the type. But the same object types are intersected again and again with something
//! that has little or no part in the answer: `Props & { theme: T }` for every `T`, so for every instantiation of an alias
//! and for every marker type of a variance computation. Each of those is a type of its own, and for each the names that
//! the constituents share are found, and the types of the properties with those names are asked for and compared.
//! `Components[keyof Components]` in a parameter is an intersection of hundreds of object types that share most of
//! their names.
//!
//! Which names the constituents share, and where (`SharedNames`), depends on their shapes alone. It is kept for the list of
//! the shapes (`Reductions::by_shapes`).
//!
//! `examine_shared_properties` examines one name at a time. It looks at the properties with the name and at the mappers of
//! the constituents that have them, and at nothing else of the intersection but what `OfName::has_two_symbols` stands for.
//! So what a name has added to the answer is kept
//! - for the list of the shapes, until one of those mappers is another one (`Outcomes`): nothing is looked up then;
//! - for those properties and those mappers (`Reductions::by_holders`): two intersections of hundreds of object types that
//!   differ in one of them have most of their names in common, with the same properties.
//!
//! The rule that makes that exact. tsgo examines every name of every intersection, so an examination that is left out must
//! be one that nothing could tell from none:
//!
//! - The one that is kept left no trace (`traces_of_reduction`): it made no query, computed no instantiation, added
//!   nothing to `instantiationCount`, created no record, reported nothing, found nothing in progress or cut short, and
//!   marked no variance. So it found all it asked for in the type store and in tables.
//! - Or all it left is what it computed (`KEEPS_FIRST_EXAMINATION`): queries, instantiations and records. Nothing was found in
//!   progress or cut short, and no frame is tainted (`stores_what_it_computes`), so every result went into its table. And
//!   it made none of the calls that count every time (`Kept::counts_each_time`). So the next one would leave no trace.
//! - What it found there stays (`is_settled_for_reduction`). An evaluation begins with a miss, so an entry is replaced only
//!   by an evaluation of its key that began before the entry was stored and ends after it was read.
//! - What it did not find there, and did not evaluate, says the same once it is there. `type_of_mapped_prop` asks in that
//!   way for the type that the property has in the mapped type it was created for. An entry says what its absence did not
//!   only if it comes from a cycle or a limit, so an examination that has asked so is kept until the next one
//!   (`generation_of_reductions`). `is_empty_anonymous_object_type` asks in that way for members, which can come at any
//!   time: that is a trace.
//! - So the same examination made later finds the same, takes the same path and leaves no trace either. Unless something
//!   is in progress that a function looks at before it looks into a table: then it is made (`unrest_of_reduction`).
//! - While a mapper is active, an `instantiate` with it counts once for each type and marks the type for the next one, also
//!   where `type_of_instantiated_symbol` takes the count back. So an examination is neither kept nor left out while one of
//!   the mappers that it instantiates with may be active (`KeptOfName::mappers_used`).
//! - The names that are examined are examined in the order in which all of them would be.
//! - A shape and a property are known by their addresses, so the shape has to be a stored one (`has_stored_members`):
//!   others do not outlive the file.
//! - `intersected_props` is not filled for a name that is not examined. `type_of_prop` then intersects the same types,
//!   which gives the type that the examination that is kept has found in the type store.
//!
//! All of this belongs to one checker, and so to one task. Nothing of it goes to a barrier. The thresholds change the time,
//! never a result.

use super::super::*;
use super::NeverReduced;
use crate::util::{PositionSet, fx_hash};
use smallvec::SmallVec;

/// `false`: every name of every intersection is looked for and examined, as before.
pub(super) const ENABLED: bool = true;

/// Every examination that would be left out is made. It is a panic that names the intersection and the file if it leaves a
/// trace or adds something else to the answer. For debugging.
pub(super) const SHADOW: bool = false;

/// `false`: only an examination that left no trace is kept, so the second one of its kind. `SHADOW` checks this too, and
/// the next two.
const KEEPS_FIRST_EXAMINATION: bool = true;

/// `false`: all that is kept ends with the next cycle or limit.
const OUTLASTS_CYCLES: bool = true;

/// `false`: nothing is left out or kept while an instantiation is in progress.
const WORKS_IN_INSTANTIATIONS: bool = true;

/// With fewer properties in its constituents, nothing is kept for an intersection: there is little to find again.
pub(super) const MIN_PROPERTIES: usize = 16;

/// What a name has added is kept in `Reductions::by_holders` if so many constituents have it. To examine the properties of
/// fewer takes about as long as to look them up.
const MIN_HOLDERS: usize = 4;

/// Up to here the constituents are compared pair by pair. The pairs grow with the square of the constituents, so for more
/// of them the constituents that have each name are counted.
const FEW_CONSTITUENTS: usize = 8;

/// The names of `Checker::member_counts`. `Report` has a default value, which an array has up to a length of 32.
pub const MEMBER_COUNTS: [&str; 32] = [
    "intersections reduced",
    "with a shared name",
    "nothing is kept for",
    "not at rest: instantiation",
    "not at rest: symbol links",
    "not at rest: check mode",
    "not at rest: comparison",
    "lists of shapes seen once",
    "lists of shapes",
    "shared names",
    "holders of those",
    "left out",
    "left out by holders",
    "examined: few holders",
    "examined: new",
    "examined: of an earlier generation",
    "examined: a mapper is active",
    "examined: first with two symbols",
    "left a trace",
    "kept at once",
    "not settled",
    "unions made objects",
    "of members with shapes seen before",
    "of constituents with shapes seen before",
    "properties of unions created",
    "members visited",
    "members visited without facts",
    "intersections listed",
    "properties listed",
    "intersections left unlisted",
    "asked of unlisted intersections",
    "listed after being asked",
];

/// An index into `MEMBER_COUNTS`.
#[derive(Copy, Clone)]
pub(in super::super) enum MemberCount {
    /// `never_intersections` did not have the intersection.
    Reduced,
    /// `may_have_never_reduced_property` was asked, for whatever reason.
    WithSharedName,
    /// It has few properties, members that are not stored, or itself for `this`.
    NothingIsKeptFor,
    /// See `unrest_of_reduction`, also for the next three.
    InInstantiation,
    HasSymbolLinks,
    InCheckMode,
    InComparison,
    SeenOnce,
    /// `Reductions::by_shapes` got an entry.
    ListsOfShapes,
    /// The names that the constituents share, where something may be kept.
    SharedNames,
    HoldersOfThose,
    /// Of those names: not examined, because of `Outcomes`.
    LeftOut,
    /// .. because of `Reductions::by_holders`.
    LeftOutByHolders,
    /// Examined: the list of shapes has no entry, and fewer than `MIN_HOLDERS` have the name.
    FewHolders,
    /// .. nothing is kept for it.
    New,
    /// .. there was a cycle or a limit since.
    OfAnEarlierGeneration,
    /// .. or not kept after it.
    MapperIsActive,
    FirstWithTwoSymbols,
    /// Examined, and not kept.
    LeftATrace,
    /// Kept although it computed something.
    KeptAtOnce,
    NotSettled,
    /// `union_objects` did not have the union.
    UnionsMadeObjects,
    /// .. and another union had members with the same shapes, in the same order, under whatever mappers.
    OfMembersWithShapesSeenBefore,
    /// .. or not, but its members were intersections of types with the same shapes.
    OfConstituentsWithShapesSeenBefore,
    UnionPropertiesCreated,
    MembersVisited,
    MembersVisitedWithoutFacts,
    IntersectionsListed,
    PropertiesListed,
    IntersectionsLeftUnlisted,
    /// `property_of_unlisted_intersection` was called.
    AskedOfUnlisted,
    /// .. so often that it has listed the properties.
    ListedAfterBeingAsked,
}

/// What the properties with one name add to what `examine_shared_properties` finds.
#[derive(Clone, PartialEq)]
pub(super) enum Adds {
    Nothing,
    /// `NeverReduced::Ask`
    Question,
    /// They may be a discriminant of type `never`: the types of the symbols, and that of the property if it is resolved.
    Discriminant(SmallVec<[TypeId; 4]>, Option<TypeId>),
}

#[derive(Clone, PartialEq)]
pub(super) struct OfName {
    pub(super) adds: Adds,
    /// The type of the property is resolved at once. The first time, that asks `is_shape_of_whole`, which gives the
    /// intersection to its classes and interfaces as the `this` argument. So the first such name is always examined.
    pub(super) has_two_symbols: bool,
}

/// The names that several of the constituents of an intersection have, in the order of
/// `getPropertiesOfUnionOrIntersectionType`. A name that one constituent has is passed over: there is nothing to combine
/// the property with.
pub(super) struct SharedNames {
    /// For each name, where its part of `holders` ends.
    ends: SmallVec<[u32; 8]>,
    /// The constituents that have the name, in their order, and the position of the property in each.
    holders: SmallVec<[(u32, u32); 16]>,
}

impl SharedNames {
    pub(super) fn of(all: &[Members]) -> SharedNames {
        let first_holders = first_holders_of_shared_names(all);
        let mut names = SharedNames {
            ends: SmallVec::with_capacity(first_holders.len()),
            holders: SmallVec::new(),
        };
        if all.len() <= FEW_CONSTITUENTS {
            for &(at, position) in &first_holders {
                let name = all[at as usize].shape().props[position as usize].name;
                names.holders.push((at, position));
                for (later, members) in all.iter().enumerate().skip(at as usize + 1) {
                    if let Some(position) = members.resolved.position(name) {
                        names.holders.push((later as u32, position as u32));
                    }
                }
                names.ends.push(names.holders.len() as u32);
            }
            return names;
        }
        // To look each name up in each constituent takes the product of the two. So each property is looked up among the
        // names, and goes to the place of its name.
        let mut places = FxHashMap::<Atom, u32>::default();
        for (place, &(at, position)) in first_holders.iter().enumerate() {
            let prop = &all[at as usize].shape().props[position as usize];
            places.insert(prop.name, place as u32);
        }
        let mut found: Vec<(u32, (u32, u32))> = Vec::new();
        let mut starts = vec![0u32; first_holders.len() + 1];
        for (at, members) in all.iter().enumerate() {
            let has_distinct_names = members.resolved.has_distinct_names();
            for (position, prop) in members.shape().props.iter().enumerate() {
                let Some(&place) = places.get(&prop.name) else {
                    continue;
                };
                let holder = (at as u32, position as u32);
                // Of two properties of one constituent with one name: the first one where the name comes first, and
                // the one that a lookup finds in a later constituent.
                let is_the_one = match first_holders[place as usize] {
                    first if first.0 == holder.0 => first == holder,
                    _ if has_distinct_names => true,
                    _ => members.resolved.position(prop.name) == Some(position),
                };
                if is_the_one {
                    found.push((place, holder));
                    starts[place as usize + 1] += 1;
                }
            }
        }
        for place in 1..starts.len() {
            starts[place] += starts[place - 1];
        }
        names.ends.extend_from_slice(&starts[1..]);
        names.holders.resize(found.len(), (0, 0));
        for (place, holder) in found {
            let next = &mut starts[place as usize];
            names.holders[*next as usize] = holder;
            *next += 1;
        }
        names
    }

    #[inline]
    pub(super) fn len(&self) -> usize {
        self.ends.len()
    }

    /// The constituents that have the name at `place`.
    #[inline]
    pub(super) fn holders(&self, place: usize) -> &[(u32, u32)] {
        let start = match place {
            0 => 0,
            _ => self.ends[place - 1] as usize,
        };
        &self.holders[start..self.ends[place] as usize]
    }

    /// For each of `count` constituents, the places of the names that it has.
    fn places_of_constituents(&self, count: usize) -> Box<[Box<[u32]>]> {
        let mut places: Vec<Vec<u32>> = vec![Vec::new(); count];
        for place in 0..self.len() {
            for &(at, _) in self.holders(place) {
                places[at as usize].push(place as u32);
            }
        }
        places.into_iter().map(Vec::into_boxed_slice).collect()
    }
}

/// What an examination of a name has added, and when the next one may be left out.
#[derive(Clone)]
struct KeptOfName {
    of_name: OfName,
    /// `generation_of_reductions` when it was made. `FOR_GOOD`: it asked for nothing that a cycle or a limit can add.
    generation: u64,
    /// A bit for each mapper that it has given to `instantiate`, or would without `recent_instantiations`: the number of
    /// the mapper modulo 64.
    mappers_used: u64,
}

const FOR_GOOD: u64 = u64::MAX;

impl KeptOfName {
    /// `Err`: why the name is examined all the same.
    fn may_be_left_out(&self, kept: &Kept) -> Result<(), MemberCount> {
        if self.generation != FOR_GOOD && self.generation != kept.generation {
            return Err(MemberCount::OfAnEarlierGeneration);
        }
        if self.mappers_used & kept.active_mappers != 0 {
            return Err(MemberCount::MapperIsActive);
        }
        Ok(())
    }
}

/// What the last examination of each name has added, if it may be left out the next time.
struct Outcomes {
    /// In the order of `SharedNames`.
    of_names: Box<[Option<KeptOfName>]>,
    /// The mappers of the constituents that `of_names` is for.
    mappers: Box<[MapperId]>,
}

/// What is kept for a list of shapes.
struct Entry {
    names: SharedNames,
    /// `SharedNames::places_of_constituents`
    places: Box<[Box<[u32]>]>,
    outcomes: Outcomes,
}

/// What `examine_shared_properties` may leave out and keep, for one intersection.
pub(super) struct Kept<'a> {
    outcomes: Option<&'a mut Outcomes>,
    /// `generation_of_reductions`
    generation: u64,
    /// A bit for each active mapper, as in `KeptOfName::mappers_used`.
    active_mappers: u64,
    /// `is_settled_for_reduction`
    may_keep: bool,
    /// An examination has ended what was kept. Nothing more is left out or kept for this intersection.
    is_over: bool,
    /// The key in `Reductions::by_holders` of the name that is looked at. Empty: it has none.
    holders: SmallVec<[(PropAddress, MapperId); 8]>,
    /// The examination of that name has made a call that adds to `instantiationCount`, or compares types, each time it
    /// is made: `instantiate` outside `type_of_instantiated_symbol`, `intersection` with a type variable.
    pub(super) counts_each_time: bool,
}

/// What `begin_name_of_reduction` has found, for `end_name_of_reduction`.
pub(super) struct BeforeName {
    traces: [u64; TRACES],
    reliability: u8,
    mappers_used: u64,
    absent_types_of_mapped_props: u64,
}

/// The length of `traces_of_reduction`.
const TRACES: usize = 12;
/// The first so many of them say what was computed. See `KEEPS_FIRST_EXAMINATION`.
const TRACES_OF_COMPUTING: usize = 4;

/// The address of a `Resolved`.
type ShapeAddress = usize;
/// The address of a `Prop`.
type PropAddress = usize;

#[derive(Default)]
pub(in super::super) struct Reductions {
    /// By the shapes of the constituents of an intersection.
    by_shapes: FxHashMap<Box<[ShapeAddress]>, Entry>,
    /// The hashes of the lists of shapes that have come once. A list gets its entry when it comes again.
    seen_once: crate::util::FxHashSet<u64>,
    /// By the properties with one name, in the order of the constituents, each with the mapper of its constituent.
    by_holders: FxHashMap<Box<[(PropAddress, MapperId)]>, KeptOfName>,
    /// See `KeptOfName::mappers_used`: since `begin_name_of_reduction`.
    mappers_used: u64,
    /// How often `type_of_mapped_prop` went on without the type that the property has in the mapped type it was created
    /// for.
    absent_types_of_mapped_props: u64,
    /// How often `is_empty_anonymous_object_type` went on without the members of the type.
    absent_members: u64,
    counts: [u64; MEMBER_COUNTS.len()],
}

/// For each name that several of `all` have, the first that has it and the position of the property there, in the order of
/// `SharedNames`.
fn first_holders_of_shared_names(all: &[Members]) -> Vec<(u32, u32)> {
    let mut first_holders = Vec::new();
    let mut seen = crate::util::FxHashSet::<Atom>::default();
    let mut constituents_with_name = FxHashMap::<Atom, u32>::default();
    if all.len() > FEW_CONSTITUENTS {
        for members in all {
            for prop in &members.shape().props {
                *constituents_with_name.entry(prop.name).or_default() += 1;
            }
        }
    }
    // The positions of the properties of a constituent that are looked at.
    let mut shared = PositionSet::default();
    for (at, &members) in all.iter().enumerate() {
        let rest = &all[at + 1..];
        if rest.is_empty() {
            break;
        }
        let props = &members.shape().props;
        shared.reset(props.len());
        if all.len() > FEW_CONSTITUENTS {
            for (position, prop) in props.iter().enumerate() {
                if constituents_with_name.get(&prop.name) > Some(&1) {
                    shared.insert(position);
                }
            }
        } else {
            add_positions_of_shared_names(members, rest, &mut shared);
        }
        for position in shared.iter() {
            // Of two only the first gets here, and all its names are new.
            if all.len() <= 2 || seen.insert(props[position].name) {
                first_holders.push((at as u32, position as u32));
            }
        }
    }
    first_holders
}

/// Adds the positions of the properties of `members` whose name one of `others` has too. Of two constituents, the names of
/// the one that has fewer are looked up in the other.
fn add_positions_of_shared_names(
    members: Members,
    others: &[Members],
    positions: &mut PositionSet,
) {
    let props = &members.shape().props;
    for other in others {
        if !members.resolved.may_share_a_name_with(other.resolved) {
            continue;
        }
        let of_other = &other.shape().props;
        if of_other.len() < props.len() {
            for prop in of_other {
                if let Some(position) = members.resolved.position(prop.name) {
                    positions.insert(position);
                }
            }
        } else {
            for (position, prop) in props.iter().enumerate() {
                if other.resolved.prop(prop.name).is_some() {
                    positions.insert(position);
                }
            }
        }
    }
}

impl<'p, 's> Checker<'p, 's> {
    #[inline]
    pub(in super::super) fn tally(&mut self, what: MemberCount, more: usize) {
        self.reductions.counts[what as usize] += more as u64;
    }

    /// In the order of `MEMBER_COUNTS`. A function of the program and of how it is cut into tasks.
    pub fn member_counts(&self) -> [u64; MEMBER_COUNTS.len()] {
        self.reductions.counts
    }

    /// `examine_shared_properties` for the intersection `ty` of `parts`, whose members `all` are the stored ones and have
    /// their own `this`.
    pub(super) fn never_reduced_by_constituents(
        &mut self,
        ty: TypeId,
        parts: &[TypeId],
        all: &[Members<'p>],
    ) -> NeverReduced {
        if let Some(unrest) = self.unrest_of_reduction() {
            self.tally(unrest, 1);
            let names = SharedNames::of(all);
            return self.examine_shared_properties(ty, parts, all, false, &names, None);
        }
        let mut kept = Kept {
            outcomes: None,
            generation: self.generation_of_reductions(),
            active_mappers: self.active_mappers.bits(),
            may_keep: self.is_settled_for_reduction(),
            is_over: false,
            holders: SmallVec::new(),
            counts_each_time: false,
        };
        let shapes: SmallVec<[ShapeAddress; 8]> = (all.iter())
            .map(|members| std::ptr::from_ref(members.resolved) as ShapeAddress)
            .collect();
        // An examination of the same shapes inside this one finds no entry, and the entry it makes is replaced.
        let entry = self.reductions.by_shapes.remove_entry(&shapes[..]);
        let (shapes, mut entry) = match entry {
            Some(entry) => entry,
            // The product of two unions of 170 object types is 28,900 intersections, each of two shapes of its own.
            None if self.reductions.seen_once.insert(fx_hash(&shapes[..])) => {
                self.tally(MemberCount::SeenOnce, 1);
                let names = SharedNames::of(all);
                self.tally(MemberCount::SharedNames, names.len());
                self.tally(MemberCount::HoldersOfThose, names.holders.len());
                let kept = Some(&mut kept);
                return self.examine_shared_properties(ty, parts, all, false, &names, kept);
            }
            None => {
                self.tally(MemberCount::ListsOfShapes, 1);
                let names = SharedNames::of(all);
                let outcomes = Outcomes {
                    of_names: vec![None; names.len()].into(),
                    mappers: all.iter().map(|members| members.mapper).collect(),
                };
                let entry = Entry {
                    places: names.places_of_constituents(all.len()),
                    names,
                    outcomes,
                };
                (Box::from(&shapes[..]), entry)
            }
        };
        let outcomes = &mut entry.outcomes;
        let constituents = (outcomes.mappers.iter_mut().zip(all)).zip(entry.places.iter());
        for ((kept, members), places) in constituents {
            if *kept != members.mapper {
                *kept = members.mapper;
                for &place in places.iter() {
                    outcomes.of_names[place as usize] = None;
                }
            }
        }
        self.tally(MemberCount::SharedNames, entry.names.len());
        self.tally(MemberCount::HoldersOfThose, entry.names.holders.len());
        kept.outcomes = Some(outcomes);
        let kept = Some(&mut kept);
        let answer = self.examine_shared_properties(ty, parts, all, false, &entry.names, kept);
        self.reductions.by_shapes.insert(shapes, entry);
        answer
    }

    /// What the name at `place` adds, if its examination may be left out. `holders`: `SharedNames::holders(place)`, among
    /// `all`.
    pub(super) fn kept_of_name(
        &mut self,
        kept: &mut Kept,
        place: usize,
        all: &[Members<'p>],
        holders: &[(u32, u32)],
    ) -> Option<OfName> {
        kept.holders.clear();
        kept.counts_each_time = false;
        if kept.is_over {
            return None;
        }
        let of_list = kept.outcomes.as_deref();
        let of_list = of_list.and_then(|it| it.of_names.get(place)?.as_ref());
        if let Some(of_list) = of_list
            && of_list.may_be_left_out(kept).is_ok()
        {
            self.tally(MemberCount::LeftOut, 1);
            return Some(of_list.of_name.clone());
        }
        // What is kept for the list is kept for the holders too, if there are enough of them.
        let why_not = of_list.and_then(|it| it.may_be_left_out(kept).err());
        if holders.len() < MIN_HOLDERS {
            let is_new = match kept.outcomes.is_none() {
                true => MemberCount::FewHolders,
                false => MemberCount::New,
            };
            self.tally(why_not.unwrap_or(is_new), 1);
            return None;
        }
        kept.holders.extend(holders.iter().map(|&(at, position)| {
            let members = all[at as usize];
            let prop = &members.shape().props[position as usize];
            (std::ptr::from_ref(prop) as PropAddress, members.mapper)
        }));
        let of_holders = match self.reductions.by_holders.get(&kept.holders[..]) {
            Some(of_holders) => (of_holders.may_be_left_out(kept)).map(|()| of_holders.clone()),
            None => Err(why_not.unwrap_or(MemberCount::New)),
        };
        let of_holders = match of_holders {
            Ok(of_holders) => of_holders,
            Err(why_not) => {
                self.tally(why_not, 1);
                return None;
            }
        };
        self.tally(MemberCount::LeftOutByHolders, 1);
        let of_name = of_holders.of_name.clone();
        if let Some(of_list) = kept.outcomes.as_deref_mut()
            && let Some(of_list) = of_list.of_names.get_mut(place)
        {
            *of_list = Some(of_holders);
        }
        Some(of_name)
    }

    /// `instantiate` is given `mapper`, or would be without `recent_instantiations`.
    #[inline]
    pub(in super::super) fn note_mapper_used(&mut self, mapper: MapperId) {
        if ENABLED && WORKS_IN_INSTANTIATIONS {
            self.reductions.mappers_used |= 1 << (mapper.0 % 64);
        }
    }

    /// See `Reductions::absent_types_of_mapped_props`.
    #[inline]
    pub(in super::super) fn note_absent_type_of_mapped_prop(&mut self) {
        self.reductions.absent_types_of_mapped_props += 1;
    }

    /// See `Reductions::absent_members`.
    #[inline]
    pub(in super::super) fn note_absent_members(&mut self) {
        self.reductions.absent_members += 1;
    }

    /// Before the examination of a name whose outcome may be kept.
    pub(super) fn begin_name_of_reduction(&mut self) -> BeforeName {
        BeforeName {
            reliability: std::mem::take(&mut self.reliability),
            mappers_used: std::mem::take(&mut self.reductions.mappers_used),
            absent_types_of_mapped_props: self.reductions.absent_types_of_mapped_props,
            traces: self.traces_of_reduction(),
        }
    }

    /// The examination of the name at `place`, for the intersection `ty`, has added `of_name`. `kept_of_name` was asked for
    /// that name last. `left_out`: under `SHADOW`, what would have been added in its place.
    pub(super) fn end_name_of_reduction(
        &mut self,
        ty: TypeId,
        kept: &mut Kept,
        place: usize,
        before: &BeforeName,
        of_name: &OfName,
        left_out: Option<&OfName>,
    ) {
        let (after, marks_no_variance) = (self.traces_of_reduction(), self.reliability == 0);
        self.reliability |= before.reliability;
        let mappers_used = self.reductions.mappers_used;
        self.reductions.mappers_used |= before.mappers_used;
        let has_left_no_trace = marks_no_variance && after == before.traces;
        if let Some(left_out) = left_out {
            if !has_left_no_trace || left_out != of_name {
                self.fact_differs_for("what a name adds to the reduction", &[ty]);
            }
            return;
        }
        if kept.is_over {
            return;
        }
        if !has_left_no_trace {
            // What it has done can end what is kept for the names that come after it.
            if self.generation_of_reductions() != kept.generation
                || self.unrest_of_reduction().is_some()
            {
                self.tally(MemberCount::LeftATrace, 1);
                kept.is_over = true;
                return;
            }
            kept.may_keep = kept.may_keep && self.is_settled_for_reduction();
            let has_only_computed = marks_no_variance
                && after[TRACES_OF_COMPUTING..] == before.traces[TRACES_OF_COMPUTING..];
            if !KEEPS_FIRST_EXAMINATION
                || !has_only_computed
                || kept.counts_each_time
                || !self.stores_what_it_computes()
            {
                self.tally(MemberCount::LeftATrace, 1);
                return;
            }
        }
        if mappers_used & kept.active_mappers != 0 {
            self.tally(MemberCount::MapperIsActive, 1);
            return;
        }
        if !kept.may_keep {
            self.tally(MemberCount::NotSettled, 1);
            return;
        }
        if !has_left_no_trace {
            self.tally(MemberCount::KeptAtOnce, 1);
        }
        let has_asked_in_vain =
            self.reductions.absent_types_of_mapped_props != before.absent_types_of_mapped_props;
        let of_name = KeptOfName {
            of_name: of_name.clone(),
            generation: match OUTLASTS_CYCLES && !has_asked_in_vain {
                true => FOR_GOOD,
                false => kept.generation,
            },
            mappers_used,
        };
        if !kept.holders.is_empty() {
            let holders = Box::from(&kept.holders[..]);
            self.reductions.by_holders.insert(holders, of_name.clone());
        }
        if let Some(outcomes) = kept.outcomes.as_deref_mut()
            && let Some(of_list) = outcomes.of_names.get_mut(place)
        {
            *of_list = Some(of_name);
        }
    }

    /// What is in progress that an examination looks at before it looks into a table, or changes without a trace. `None`:
    /// nothing.
    /// - An instantiation: the depth and the count have a limit, which comes before the tables. And `instantiate` and
    ///   `members` look at `index_infos_in_instantiation` and `unresolved_members` first. For the active mappers see
    ///   `KeptOfName::mappers_used`.
    /// - `type_of_prop` looks at `instantiated_symbol_links` first.
    /// - A check that neither reads nor stores the types of expressions: a property of an object literal has one.
    /// - `T & string` is reduced by a comparison with the constraint of `T`. An overflow that a caller has yet to read: a
    ///   comparison assigns one flag and sets the other. A comparison that was cut short in this file is not evaluated again.
    fn unrest_of_reduction(&self) -> Option<MemberCount> {
        let deepest = match WORKS_IN_INSTANTIATIONS {
            true => 99,
            false => 0,
        };
        if self.instantiation_depth > deepest
            || self.instantiation_count >= 5_000_000
            || !self.index_infos_in_instantiation.is_empty()
            || !self.unresolved_members.is_empty()
        {
            return Some(MemberCount::InInstantiation);
        }
        if !self.instantiated_symbol_links.is_empty() {
            return Some(MemberCount::HasSymbolLinks);
        }
        if self.is_rechecking() || self.pulls_contextual_types() {
            return Some(MemberCount::InCheckMode);
        }
        let is_comparing = self.relation_too_complex
            || self.relation_too_deep
            || !self.relations_cut_short.is_empty()
            || !self.generic_mapped_types_cut_short.is_empty();
        is_comparing.then_some(MemberCount::InComparison)
    }

    /// Whether the result of every query and every instantiation that is made now, and finds nothing in progress or cut
    /// short, goes into its table. Under a tainted frame it is kept for as long as that frame is in progress.
    fn stores_what_it_computes(&self) -> bool {
        self.provisional.is_empty() && self.frames.iter().all(|frame| !frame.tainted)
    }

    /// Whether what an examination finds in tables now stays there, where `unrest_of_reduction` finds nothing: no frame stores
    /// over what a visit inside it has stored. A type node and a conditional type do, and nothing says whether there was
    /// such a visit. Of the other queries that do, the frame says so.
    fn is_settled_for_reduction(&self) -> bool {
        self.stack.iter().zip(&self.frames).all(|(q, frame)| {
            !matches!(q, Query::TypeNode(..) | Query::Cond(..))
                && !frame.has_result
                && !frame.is_stored_by_nested_visit
        })
    }

    /// Grows with every cycle and every limit, of this task or in what another task may have committed.
    fn generation_of_reductions(&self) -> u64 {
        (self.cycles + self.limits_in_earlier_files + self.limits + self.instantiation_limit_hits)
            .wrapping_add(self.state_of_commits())
    }

    /// Changes with everything that an examination can do, together with `reliability`. Those that are added up only grow.
    /// A scope that begins and ends is no trace: `examine_shared_properties` has one for each name.
    fn traces_of_reduction(&self) -> [u64; TRACES] {
        [
            self.work,
            self.instantiations_computed,
            u64::from(self.instantiation_count),
            self.task.own.created().iter().sum::<usize>() as u64,
            self.reported.len() as u64,
            self.task.diagnostics.len() as u64,
            self.cycles + self.taints,
            self.lowest_taint as u64,
            self.limits + self.instantiation_limit_hits,
            self.times_cut_short.get() + self.unmarked_refusals,
            u64::from(self.variance_cycles) + u64::from(self.any_signature_reads),
            self.reductions.absent_members,
        ]
    }
}
