use super::LinkError;
use super::keys::{collect_shards, number_by_unit};
use super::state::{MergedTypes, UnitIds, UnitMarks};
use super::type_hashes::ContentHash;
use super::unit::{LinkUnit, shard_of};
use crate::ir::parallel::map_each;
use crate::ir::{Id, IdMap, InParallel, PreparedType, Type, TypeId, TypeTable, for_each_mut};
use core::cmp::Ordering;
use core::ops::Range;

// None: the type is well known.
fn find_depth(units: &[LinkUnit], (unit, local): (u32, TypeId)) -> Option<u32> {
    let is_well_known = local.index() < TypeTable::WELL_KNOWN_COUNT;
    (!is_well_known).then(|| units[unit as usize].type_hashes.nesting_depths[local.index()])
}

pub(super) fn merge_types(
    units: &[LinkUnit],
    marks: &[UnitMarks],
    in_parallel: InParallel<'_>,
) -> MergedTypes {
    debug_assert_eq!(units.len(), marks.len());
    let shards = collect_shards(in_parallel, &|number, shard| {
        for (position, (unit, unit_marks)) in units.iter().zip(marks).enumerate() {
            for &local in unit.type_shards.shard(number) {
                if unit_marks.types[local as usize] {
                    let hash = unit.type_hashes.types[local as usize];
                    let entry = (position as u32, TypeId::new(local as usize));
                    shard.add(hash, entry, |_, other| other == hash);
                }
            }
        }
    });
    let (program_ids, type_representatives) =
        number_by_unit(&shards, units.len(), in_parallel, &|unit, local| {
            (find_depth(units, (unit, local)), local)
        });

    let units_with_marks: Vec<(&LinkUnit, &UnitMarks)> = units.iter().zip(marks).collect();
    let types = map_each(units_with_marks, in_parallel, &|(unit, marks)| {
        let program_id = |(&hash, &is_retained): (&ContentHash, &bool)| {
            if !is_retained {
                return None;
            }
            let shard = shard_of(hash.into());
            let entry = shards[shard]
                .find(hash, |_, other| other == hash)
                .expect("every retained type was merged");
            Some(program_ids[shard][entry as usize])
        };
        let hashes = unit.type_hashes.types.iter();
        hashes.zip(&marks.types).map(program_id).collect()
    });

    MergedTypes {
        types,
        type_representatives,
    }
}

fn compare_contents(a: &Type, b: &Type) -> Ordering {
    let scalars = |ty: &Type| {
        let (primitives, flags) = (ty.primitives.to_wire(), ty.flags.to_wire());
        let opaque = ty.opaque.map(|kind| kind.to_wire());
        let range = (ty.minimum, ty.maximum);
        (primitives, flags, opaque, ty.environment, range)
    };
    let [builtins_of_a, builtins_of_b] = [a, b].map(|ty| ty.builtins.iter().map(|id| id.to_wire()));
    let [classes_of_a, classes_of_b] = [a, b].map(|ty| {
        let parts = ty.classes.iter();
        parts.map(|part| (part.builtin_class.to_wire(), &part.contents))
    });
    scalars(a)
        .cmp(&scalars(b))
        .then_with(|| a.strings.cmp(&b.strings))
        .then_with(|| a.layouts.cmp(&b.layouts))
        .then_with(|| a.functions.cmp(&b.functions))
        .then_with(|| builtins_of_a.cmp(builtins_of_b))
        .then_with(|| classes_of_a.cmp(classes_of_b))
}

// The representatives of one file at one depth stand in a row: the rows of more than one, by depth.
fn find_runs_by_depth(
    units: &[LinkUnit],
    representatives: &[(u32, TypeId)],
) -> Vec<Vec<Range<usize>>> {
    let depth_of = |&representative: &(u32, TypeId)| find_depth(units, representative);
    let mut runs_by_depth: Vec<Vec<Range<usize>>> = Vec::new();
    let mut start = 0;
    for run in representatives.chunk_by(|a, b| a.0 == b.0 && depth_of(a) == depth_of(b)) {
        if let Some(depth) = depth_of(&run[0])
            && run.len() > 1
        {
            let depth = depth as usize;
            if runs_by_depth.len() <= depth {
                runs_by_depth.resize_with(depth + 1, Vec::new);
            }
            runs_by_depth[depth].push(start..start + run.len());
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
    for runs in find_runs_by_depth(units, representatives) {
        // The places that the members of a run have had, in their new order.
        let orders = map_each(runs, in_parallel, &|run: Range<usize>| {
            let unit = representatives[run.start].0 as usize;
            let map = ids[unit].as_map();
            let mut remapped = Vec::with_capacity(run.len());
            for place in run.clone() {
                let mut ty = remap_type(&units[unit], &map, representatives[place].1);
                for id in ty.classes.iter_mut().flat_map(|part| &mut part.contents) {
                    *id = new_ids[id.index()];
                }
                remapped.push((ty, place));
            }
            remapped.sort_unstable_by(|a, b| compare_contents(&a.0, &b.0));
            let places: Vec<usize> = remapped.into_iter().map(|(_, place)| place).collect();
            (run.start, places)
        });
        for (start, places) in orders {
            for (offset, place) in places.into_iter().enumerate() {
                new_ids[place] = TypeId::new(start + offset);
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

fn check_occurrences(
    input: &TypeTableInput<'_>,
    prepared: &[PreparedType],
) -> Result<(), LinkError> {
    let (units, ids, marks) = (input.units, input.ids, input.marks);
    let representatives = input.type_representatives;
    let find_collision = |position: usize| {
        let (unit, map) = (&units[position], ids[position].as_map());
        for (local, &is_retained) in marks[position].types.iter().enumerate() {
            if !is_retained {
                continue;
            }
            let local = TypeId::new(local);
            let program_id = map.types[local.index()];
            let program_id = program_id.expect("every retained occurrence has a program id");
            let representative = representatives[program_id.index()];
            if representative == (position as u32, local) {
                continue;
            }
            if remap_type(unit, &map, local) != *prepared[program_id.index()].ty() {
                return Some([units[representative.0 as usize].file, unit.file]);
            }
        }
        None
    };
    let positions = (0..units.len()).collect();
    let collisions = map_each(positions, input.in_parallel, &find_collision);
    match collisions.into_iter().flatten().next() {
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
