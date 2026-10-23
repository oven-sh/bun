use super::LinkError;
use super::state::{MergedTypes, UnitIds, UnitMarks};
use super::type_hashes::ContentHash;
use super::unit::{LinkUnit, SHARD_COUNT, shard_of};
use crate::ir::{Id, IdMap, InParallel, PreparedType, Type, TypeId, TypeTable, for_each_mut};
use crate::load::ProgramFile;
use core::cmp::Ordering;
use hashbrown::HashTable;
use hashbrown::hash_table::Entry;

struct TypeShard {
    shard: usize,
    table: HashTable<u32>,
    entries: Vec<(u32, TypeId)>,
    hashes: Vec<ContentHash>,
    program_ids: Vec<TypeId>,
}

impl TypeShard {
    fn new(shard: usize) -> TypeShard {
        TypeShard {
            shard,
            table: HashTable::new(),
            entries: Vec::new(),
            hashes: Vec::new(),
            program_ids: Vec::new(),
        }
    }

    fn find(&self, hash: ContentHash) -> Option<u32> {
        let is_equal = |&entry: &u32| self.hashes[entry as usize] == hash;
        self.table.find(hash.0[0], is_equal).copied()
    }

    fn add_type(&mut self, unit: u32, local: TypeId, hash: ContentHash) {
        let hashes = &self.hashes;
        let entry = self.table.entry(
            hash.0[0],
            |&other| hashes[other as usize] == hash,
            |&other| hashes[other as usize].0[0],
        );
        if let Entry::Vacant(vacant) = entry {
            vacant.insert(self.entries.len() as u32);
            self.entries.push((unit, local));
            self.hashes.push(hash);
        }
    }

    fn collect_types(&mut self, units: &[LinkUnit], marks: &[UnitMarks]) {
        for (position, (unit, unit_marks)) in units.iter().zip(marks).enumerate() {
            for &local in unit.type_shards.shard(self.shard) {
                let local = TypeId::new(local as usize);
                if unit_marks.types[local.index()] {
                    let hash = unit.type_hashes.types[local.index()];
                    self.add_type(position as u32, local, hash);
                }
            }
        }
    }
}

fn order_in_unit(unit: &LinkUnit, local: TypeId) -> (bool, u32, ContentHash) {
    if local.index() < TypeTable::WELL_KNOWN_COUNT {
        return (false, 0, ContentHash([local.index() as u64, 0]));
    }
    let depth = unit.type_hashes.nesting_depths[local.index()];
    (true, depth, ContentHash([local.index() as u64, 0]))
}

fn number_types(
    shards: &mut [TypeShard],
    units: &[LinkUnit],
    in_parallel: InParallel<'_>,
) -> Vec<(u32, TypeId)> {
    let count: usize = shards.iter().map(|shard| shard.entries.len()).sum();
    let mut entries = Vec::with_capacity(count);
    for shard in shards.iter() {
        entries.extend_from_slice(&shard.entries);
    }
    entries.sort_unstable();
    let mut order: Vec<u32> = (0..count as u32).collect();
    for run in order.chunk_by_mut(|&a, &b| entries[a as usize].0 == entries[b as usize].0) {
        let unit = &units[entries[run[0] as usize].0 as usize];
        run.sort_unstable_by_key(|&entry| order_in_unit(unit, entries[entry as usize].1));
    }
    let mut program_ids = vec![TypeId::new(0); count];
    for (position, &entry) in order.iter().enumerate() {
        program_ids[entry as usize] = TypeId::new(position);
    }
    for_each_mut(shards, in_parallel, &|shard| {
        let program_id = |entry: &(u32, TypeId)| {
            let position = entries.binary_search(entry);
            program_ids[position.expect("every entry is a representative")]
        };
        shard.program_ids = shard.entries.iter().map(program_id).collect();
    });
    order.iter().map(|&entry| entries[entry as usize]).collect()
}

pub(super) fn merge_types(
    units: &[LinkUnit],
    marks: &[UnitMarks],
    in_parallel: InParallel<'_>,
) -> MergedTypes {
    debug_assert_eq!(units.len(), marks.len());
    let mut shards: Vec<TypeShard> = (0..SHARD_COUNT).map(TypeShard::new).collect();
    for_each_mut(&mut shards, in_parallel, &|shard| {
        shard.collect_types(units, marks)
    });
    let type_representatives = number_types(&mut shards, units, in_parallel);

    let mut slots: Vec<(usize, Vec<Option<TypeId>>)> = (0..units.len())
        .map(|position| (position, Vec::new()))
        .collect();
    for_each_mut(&mut slots, in_parallel, &|(position, program_ids)| {
        let program_id = |(&hash, &is_retained): (&ContentHash, &bool)| {
            if !is_retained {
                return None;
            }
            let shard = &shards[shard_of(hash.0[0])];
            let entry = shard.find(hash).expect("every retained type was merged");
            Some(shard.program_ids[entry as usize])
        };
        let hashes = units[*position].type_hashes.types.iter();
        let types = hashes.zip(&marks[*position].types);
        *program_ids = types.map(program_id).collect();
    });

    MergedTypes {
        types: slots
            .into_iter()
            .map(|(_, program_ids)| program_ids)
            .collect(),
        type_representatives,
    }
}

fn compare_contents(a: &Type, b: &Type) -> Ordering {
    let scalars = |ty: &Type| {
        let opaque = ty.opaque.map(|kind| kind.to_wire());
        let range = (ty.minimum, ty.maximum);
        (
            ty.primitives.to_wire(),
            ty.flags.to_wire(),
            opaque,
            ty.environment,
            range,
        )
    };
    let classes = |ty: &'_ Type| -> Vec<(u32, Vec<TypeId>)> {
        let parts = ty.classes.iter();
        parts
            .map(|part| (part.builtin_class.to_wire(), part.contents.clone()))
            .collect()
    };
    let builtins = |ty: &Type| -> Vec<u32> { ty.builtins.iter().map(|id| id.to_wire()).collect() };
    scalars(a)
        .cmp(&scalars(b))
        .then_with(|| a.strings.cmp(&b.strings))
        .then_with(|| a.layouts.cmp(&b.layouts))
        .then_with(|| a.functions.cmp(&b.functions))
        .then_with(|| builtins(a).cmp(&builtins(b)))
        .then_with(|| classes(a).cmp(&classes(b)))
}

// The representatives of one file at one depth: they stand in a row.
struct Run {
    start: usize,
    length: usize,
    // The places that the members have had, in their new order.
    order: Vec<u32>,
}

fn find_runs_by_depth(units: &[LinkUnit], representatives: &[(u32, TypeId)]) -> Vec<Vec<Run>> {
    let depth_of = |&(unit, local): &(u32, TypeId)| {
        let is_well_known = local.index() < TypeTable::WELL_KNOWN_COUNT;
        let depths = &units[unit as usize].type_hashes.nesting_depths;
        (!is_well_known).then(|| depths[local.index()] as usize)
    };
    let mut runs_by_depth: Vec<Vec<Run>> = Vec::new();
    let mut start = 0;
    for run in representatives.chunk_by(|a, b| a.0 == b.0 && depth_of(a) == depth_of(b)) {
        if let Some(depth) = depth_of(&run[0])
            && run.len() > 1
        {
            if runs_by_depth.len() <= depth {
                runs_by_depth.resize_with(depth + 1, Vec::new);
            }
            runs_by_depth[depth].push(Run {
                start,
                length: run.len(),
                order: Vec::new(),
            });
        }
        start += run.len();
    }
    runs_by_depth
}

/// `merge_types` numbers the types that one file is the first to name, at one depth, in the order in which the file met them.
pub(super) fn order_types_by_contents(
    units: &[LinkUnit],
    ids: &mut [UnitIds],
    representatives: &mut [(u32, TypeId)],
    in_parallel: InParallel<'_>,
) {
    let mut new_ids: Vec<TypeId> = (0..representatives.len()).map(TypeId::new).collect();
    for mut runs in find_runs_by_depth(units, representatives) {
        for_each_mut(&mut runs, in_parallel, &|run| {
            let members = &representatives[run.start..run.start + run.length];
            let unit = members[0].0 as usize;
            let map = ids[unit].as_map();
            let mut remapped = Vec::with_capacity(run.length);
            for (offset, &(_, local)) in members.iter().enumerate() {
                let mut ty = remap_type(&units[unit], &map, local);
                for id in ty.classes.iter_mut().flat_map(|part| &mut part.contents) {
                    *id = new_ids[id.index()];
                }
                remapped.push((ty, (run.start + offset) as u32));
            }
            remapped.sort_unstable_by(|a, b| compare_contents(&a.0, &b.0));
            run.order = remapped.into_iter().map(|(_, place)| place).collect();
        });
        for run in &runs {
            for (offset, &place) in run.order.iter().enumerate() {
                new_ids[place as usize] = TypeId::new(run.start + offset);
            }
        }
    }
    let previous = representatives.to_vec();
    for (representative, new_id) in previous.into_iter().zip(&new_ids) {
        representatives[new_id.index()] = representative;
    }
    for_each_mut(ids, in_parallel, &|ids| {
        for id in ids.types.iter_mut().flatten() {
            *id = new_ids[id.index()];
        }
    });
}

pub(super) struct TypeTableInput<'a> {
    pub units: &'a [LinkUnit],
    pub type_representatives: &'a [(u32, TypeId)],
    pub ids: &'a [UnitIds],
    pub marks: &'a [UnitMarks],
    pub in_parallel: InParallel<'a>,
}

const REMAP_TASK_COUNT: usize = 64;

fn remap_type(unit: &LinkUnit, map: &IdMap<'_>, local: TypeId) -> Type {
    let mut ty = unit.types.get(local).clone();
    ty.remap_ids(map);
    ty
}

fn remap_type_representatives(input: &TypeTableInput<'_>) -> Vec<PreparedType> {
    let (units, ids) = (input.units, input.ids);
    let representatives = input.type_representatives;
    let mut remapped = Vec::new();
    remapped.resize_with(representatives.len(), PreparedType::default);
    let slice_length = representatives.len().div_ceil(REMAP_TASK_COUNT).max(1);
    let mut tasks: Vec<(&[(u32, TypeId)], &mut [PreparedType])> = representatives
        .chunks(slice_length)
        .zip(remapped.chunks_mut(slice_length))
        .collect();
    for_each_mut(&mut tasks, input.in_parallel, &|(slice, types)| {
        for (&(unit, local), ty) in slice.iter().zip(types.iter_mut()) {
            let unit = unit as usize;
            *ty = TypeTable::prepare(remap_type(&units[unit], &ids[unit].as_map(), local));
        }
    });
    remapped
}

pub(super) fn collision_between(
    units: &[LinkUnit],
    representatives: &[(u32, TypeId)],
    positions: [usize; 2],
) -> LinkError {
    let files = positions.map(|position| units[representatives[position].0 as usize].file);
    LinkError::TypeHashCollision { files }
}

/// The table of the types that `prepare_types` has answered with.
pub(super) fn intern_prepared_types(prepared: Vec<PreparedType>) -> Result<TypeTable, [usize; 2]> {
    let mut table = TypeTable::new();
    table.reserve(prepared.len());
    for (position, ty) in prepared.into_iter().enumerate() {
        let id = table.intern_prepared(ty).index();
        if id != position {
            return Err([id.min(position), position]);
        }
    }
    Ok(table)
}

struct Occurrences<'a> {
    unit: u32,
    marks: &'a [bool],
    program_ids: &'a [Option<TypeId>],
    representatives: &'a [(u32, TypeId)],
}

impl Occurrences<'_> {
    fn find_conflicting_unit(&self, is_equal: impl Fn(TypeId, TypeId) -> bool) -> Option<u32> {
        for (local, &is_retained) in self.marks.iter().enumerate() {
            if !is_retained {
                continue;
            }
            let local = TypeId::new(local);
            let program_id = self.program_ids[local.index()];
            let program_id = program_id.expect("every retained occurrence has a program id");
            let representative = self.representatives[program_id.index()];
            if representative == (self.unit, local) {
                continue;
            }
            if !is_equal(local, program_id) {
                return Some(representative.0);
            }
        }
        None
    }
}

struct OccurrenceCheck<'a> {
    units: &'a [LinkUnit],
    type_representatives: &'a [(u32, TypeId)],
    ids: &'a [UnitIds],
    marks: &'a [UnitMarks],
    prepared: &'a [PreparedType],
}

impl OccurrenceCheck<'_> {
    fn find_collision(&self, position: usize) -> Option<[ProgramFile; 2]> {
        let (unit, marks) = (&self.units[position], &self.marks[position]);
        let map = self.ids[position].as_map();
        let types = Occurrences {
            unit: position as u32,
            marks: &marks.types,
            program_ids: map.types,
            representatives: self.type_representatives,
        };
        let conflicting_unit = types.find_conflicting_unit(|local, program_id| {
            remap_type(unit, &map, local) == *self.prepared[program_id.index()].ty()
        })?;
        Some([self.units[conflicting_unit as usize].file, unit.file])
    }
}

fn check_occurrences(
    input: &TypeTableInput<'_>,
    prepared: &[PreparedType],
) -> Result<(), LinkError> {
    let check = OccurrenceCheck {
        units: input.units,
        type_representatives: input.type_representatives,
        ids: input.ids,
        marks: input.marks,
        prepared,
    };
    let mut slots: Vec<(usize, Option<[ProgramFile; 2]>)> = (0..input.units.len())
        .map(|position| (position, None))
        .collect();
    for_each_mut(&mut slots, input.in_parallel, &|(position, collision)| {
        *collision = check.find_collision(*position);
    });
    match slots.into_iter().find_map(|(_, collision)| collision) {
        Some(files) => Err(LinkError::TypeHashCollision { files }),
        None => Ok(()),
    }
}

/// The types of the program in its ids, each as its first unit has it and in the form in which a table holds it, once every other unit that has the type is known to read it the same.
pub(super) fn prepare_types(input: &TypeTableInput<'_>) -> Result<Vec<PreparedType>, LinkError> {
    debug_assert_eq!(input.units.len(), input.ids.len());
    debug_assert_eq!(input.units.len(), input.marks.len());
    let prepared = remap_type_representatives(input);
    check_occurrences(input, &prepared)?;
    Ok(prepared)
}

#[cfg(test)]
pub(super) fn build_type_table(input: &TypeTableInput<'_>) -> Result<TypeTable, LinkError> {
    let prepared = remap_type_representatives(input);
    let positions = intern_prepared_types(remap_type_representatives(input));
    let table = positions.map_err(|positions| {
        collision_between(input.units, input.type_representatives, positions)
    })?;
    check_occurrences(input, &prepared)?;
    Ok(table)
}
