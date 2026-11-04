use super::numbering::TableIds;
use super::tables::LinkTables;
use crate::ir::parallel::map_each;
use crate::ir::{Id, InParallel, PropertyKey, PropertyKeyId, PropertyKeyTable};

/// `Some(None)`: the key names no such record. `None`: it names one that the program lacks.
fn find_program_id<I: Id>(id: Option<I>, program_ids: &[Option<I>]) -> Option<Option<I>> {
    match id {
        Some(id) => program_ids[id.index()].map(Some),
        None => Some(None),
    }
}

/// The key in the ids of the program. `None`: the program cannot hold it.
fn remap_key(key: &PropertyKey, ids: &TableIds) -> Option<PropertyKey> {
    let PropertyKey {
        kind,
        text,
        owner,
        symbol,
        module,
        call_number,
    } = *key;
    Some(PropertyKey {
        kind,
        text: find_program_id(text, &ids.strings)?,
        owner: find_program_id(owner, &ids.layouts)?,
        symbol,
        module: find_program_id(module, &ids.modules)?,
        call_number,
    })
}

/// Sorts the keys and drops repeats. The keys must hold ids of the program: an order among the numbers of one set of tables must not
/// reach the program.
fn sort_distinct_keys(keys: &mut Vec<PropertyKey>) {
    // Where the keys are a row of ascending runs, this sort merges the runs.
    keys.sort();
    keys.dedup();
}

// How the sort is cut into tasks. No answer depends on these.
const PART_COUNT: usize = if cfg!(test) { 8 } else { 64 };
const SAMPLES_PER_PART: usize = 8;
const MIN_PART_LENGTH: usize = if cfg!(test) { 16 } else { 1 << 12 };
const _: () = assert!(MIN_PART_LENGTH >= SAMPLES_PER_PART);

/// Ascending, no two alike. One more part than splitters.
fn choose_splitters(runs: &[Vec<PropertyKey>]) -> Vec<PropertyKey> {
    let count: usize = runs.iter().map(Vec::len).sum();
    if count < PART_COUNT * MIN_PART_LENGTH {
        return Vec::new();
    }
    // Every `stride`-th key of the runs laid end to end. Sampling each run by itself would take only the lowest key of a short run.
    let stride = count / (PART_COUNT * SAMPLES_PER_PART);
    let samples = runs.iter().flatten().step_by(stride);
    let mut samples: Vec<PropertyKey> = samples.copied().collect();
    sort_distinct_keys(&mut samples);
    let splitters = samples.into_iter().step_by(SAMPLES_PER_PART);
    splitters.skip(1).collect()
}

/// The keys of the runs, ascending, each once. Each run is ascending.
fn unite_runs(runs: &[Vec<PropertyKey>], in_parallel: InParallel<'_>) -> Vec<PropertyKey> {
    let splitters = choose_splitters(runs);
    let parts: Vec<usize> = (0..=splitters.len()).collect();
    // Keys that are alike fall into one part, and every key of a part is below every key of the next.
    let parts = map_each(parts, in_parallel, &|part: usize| {
        let from = part.checked_sub(1).map(|previous| &splitters[previous]);
        let to = splitters.get(part);
        let mut keys = Vec::new();
        for run in runs {
            let count_below = |bound: &PropertyKey| run.partition_point(|key| key < bound);
            let (start, end) = (
                from.map_or(0, count_below),
                to.map_or(run.len(), count_below),
            );
            keys.extend_from_slice(&run[start..end]);
        }
        sort_distinct_keys(&mut keys);
        keys
    });
    parts.concat()
}

/// `lists`: what is read of the keys of each set of tables.
fn merge_key_lists(
    lists: &[&[PropertyKey]],
    ids: &[TableIds],
    in_parallel: InParallel<'_>,
) -> (PropertyKeyTable, Vec<Vec<Option<PropertyKeyId>>>) {
    debug_assert_eq!(lists.len(), ids.len());
    let all_tables: Vec<usize> = (0..lists.len()).collect();
    let runs = map_each(all_tables.clone(), in_parallel, &|tables: usize| {
        let keys = lists[tables].iter();
        let keys = keys.filter_map(|key| remap_key(key, &ids[tables]));
        let mut run: Vec<PropertyKey> = keys.collect();
        sort_distinct_keys(&mut run);
        run
    });
    let program_keys = unite_runs(&runs, in_parallel);
    drop(runs);

    // The id of a key is its rank among the keys of the program.
    let program_ids: Vec<Vec<Option<PropertyKeyId>>> =
        map_each(all_tables, in_parallel, &|tables: usize| {
            let find_id = |key: &PropertyKey| {
                let rank = program_keys.binary_search(&remap_key(key, &ids[tables])?);
                let rank = rank.expect("every key that the program can hold was sorted");
                Some(PropertyKeyId::new(rank))
            };
            lists[tables].iter().map(find_id).collect()
        });
    (
        PropertyKeyTable::of_distinct_keys(program_keys),
        program_ids,
    )
}

/// The property keys of all tables in one table, ascending. The table is a set of keys in the ids of the program, laid out in a total order,
/// so it depends neither on which files share tables nor on the order of the tables.
/// The second result holds one list per set of tables: the program's id of each key, by the key's number in those tables.
/// `None`: the key names a record that the program lacks.
/// `ids` leads to the strings, the layouts and the modules of the program.
pub(super) fn merge_property_keys(
    tables: &[LinkTables],
    ids: &[TableIds],
    in_parallel: InParallel<'_>,
) -> (PropertyKeyTable, Vec<Vec<Option<PropertyKeyId>>>) {
    let lists: Vec<&[PropertyKey]> = tables
        .iter()
        .map(|tables| &tables.property_keys.as_slice()[..tables.lengths.property_keys as usize])
        .collect();
    merge_key_lists(&lists, ids, in_parallel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::testing::{layout, string};
    use crate::ir::{ModuleId, StringTable, TypeTable, WellKnownSymbol};
    use crate::link::testing::{forward, reverse};
    use crate::load::ProjectId;

    fn module(index: usize) -> ModuleId {
        ModuleId::new(index)
    }

    fn id(index: usize) -> Option<PropertyKeyId> {
        Some(PropertyKeyId::new(index))
    }

    fn text_key(text: usize) -> PropertyKey {
        PropertyKey::from_text(string(text))
    }

    fn private_name(text: usize, owner: usize) -> PropertyKey {
        PropertyKey::from_private_name(string(text), layout(owner))
    }

    fn created_symbol(creator: usize, call_number: u32) -> PropertyKey {
        PropertyKey::from_created_symbol(module(creator), call_number, None)
    }

    // String `n` of the tables is string `strings[n]` of the program, and so on.
    fn ids_of(strings: &[usize], layouts: &[usize], modules: &[usize]) -> TableIds {
        TableIds {
            strings: strings.iter().map(|&index| Some(string(index))).collect(),
            layouts: layouts.iter().map(|&index| Some(layout(index))).collect(),
            modules: modules.iter().map(|&index| Some(module(index))).collect(),
            ..TableIds::default()
        }
    }

    // A set of tables holds one text key for each of its strings, in their order. An entry lists the strings as `ids_of` takes them.
    fn merge_text_keys(
        strings_of_tables: &[Vec<usize>],
        in_parallel: InParallel<'_>,
    ) -> (PropertyKeyTable, Vec<Vec<Option<PropertyKeyId>>>) {
        let keys: Vec<Vec<PropertyKey>> = strings_of_tables
            .iter()
            .map(|strings| (0..strings.len()).map(text_key).collect())
            .collect();
        let lists: Vec<&[PropertyKey]> = keys.iter().map(Vec::as_slice).collect();
        let ids: Vec<TableIds> = strings_of_tables
            .iter()
            .map(|strings| ids_of(strings, &[], &[]))
            .collect();
        merge_key_lists(&lists, &ids, in_parallel)
    }

    #[test]
    fn no_tables_hold_no_keys() {
        let (table, program_ids) = merge_key_lists(&[], &[], &forward);
        assert!(table.is_empty() && program_ids.is_empty());
    }

    #[test]
    fn tables_that_number_strings_differently_share_their_keys() {
        let (table, program_ids) = merge_text_keys(&[vec![5, 2], vec![2, 9]], &forward);
        assert_eq!(table.as_slice(), [2, 5, 9].map(text_key));
        assert_eq!(program_ids, [[id(1), id(0)], [id(0), id(2)]]);
    }

    #[test]
    fn private_name_is_one_key_per_owner() {
        let first = [private_name(0, 0), private_name(0, 1)];
        let second = [private_name(0, 0)];
        let ids = [ids_of(&[0], &[4, 3], &[]), ids_of(&[0], &[4], &[])];
        let (table, program_ids) = merge_key_lists(&[&first, &second], &ids, &forward);
        assert_eq!(table.as_slice(), [private_name(0, 3), private_name(0, 4)]);
        assert_eq!(program_ids, [vec![id(1), id(0)], vec![id(1)]]);
    }

    #[test]
    fn created_symbols_differ_by_module_and_call_number() {
        let first = [
            created_symbol(0, 10),
            created_symbol(0, 20),
            created_symbol(1, 10),
        ];
        let second = [created_symbol(0, 10)];
        let ids = [ids_of(&[], &[], &[6, 1]), ids_of(&[], &[], &[1])];
        let (table, program_ids) = merge_key_lists(&[&first, &second], &ids, &forward);
        let expected = [
            created_symbol(1, 10),
            created_symbol(6, 10),
            created_symbol(6, 20),
        ];
        assert_eq!(table.as_slice(), expected);
        assert_eq!(program_ids, [vec![id(1), id(2), id(0)], vec![id(0)]]);
    }

    #[test]
    fn keys_of_one_set_of_tables_that_become_alike_share_an_id() {
        let keys = [created_symbol(0, 10), created_symbol(1, 10)];
        let ids = [ids_of(&[], &[], &[3, 3])];
        let (table, program_ids) = merge_key_lists(&[&keys], &ids, &forward);
        assert_eq!(table.as_slice(), [created_symbol(3, 10)]);
        assert_eq!(program_ids, [[id(0), id(0)]]);
    }

    #[test]
    fn key_that_names_a_record_without_an_id_is_left_out() {
        let iterator = PropertyKey::from_well_known_symbol(WellKnownSymbol::Iterator);
        let keys = [
            text_key(0),
            private_name(1, 0),
            created_symbol(0, 10),
            PropertyKey::from_created_symbol(module(1), 10, Some(string(0))),
            private_name(1, 1),
            iterator,
        ];
        let ids = TableIds {
            strings: vec![None, Some(string(0))],
            layouts: vec![None, Some(layout(0))],
            modules: vec![None, Some(module(0))],
            ..TableIds::default()
        };
        let (table, program_ids) = merge_key_lists(&[&keys], &[ids], &forward);
        assert_eq!(table.as_slice(), [private_name(0, 0), iterator]);
        assert_eq!(program_ids, [[None, None, None, None, id(0), id(1)]]);
    }

    // Enough keys for many parts.
    #[test]
    fn program_does_not_depend_on_how_the_keys_are_spread_over_tables() {
        let mut strings_of_tables: [Vec<usize>; 3] = [
            (0..1200).rev().collect(),
            (900..2000).collect(),
            (0..2000).step_by(7).collect(),
        ];
        let (table, program_ids) = merge_text_keys(&strings_of_tables, &forward);
        let expected: Vec<PropertyKey> = (0..2000).map(text_key).collect();
        assert_eq!(table.as_slice(), expected);
        for (strings, program_ids) in strings_of_tables.iter().zip(&program_ids) {
            // A text key stands where its text stands among the strings.
            let ranks = strings.iter().map(|&text| id(text));
            assert!(program_ids.iter().copied().eq(ranks));
        }

        strings_of_tables.reverse();
        let (table, mut ids_in_reverse) = merge_text_keys(&strings_of_tables, &reverse);
        ids_in_reverse.reverse();
        assert_eq!(table.as_slice(), expected);
        assert_eq!(ids_in_reverse, program_ids);

        let every_string: Vec<usize> = (0..2000).collect();
        let (table, _) = merge_text_keys(&[every_string], &forward);
        assert_eq!(table.as_slice(), expected);
    }

    #[test]
    fn key_behind_the_length_of_its_tables_is_not_read() {
        let mut property_keys = PropertyKeyTable::default();
        property_keys.intern(text_key(0));
        property_keys.intern(text_key(1));
        let mut tables = LinkTables {
            project: ProjectId::Application,
            strings: StringTable::default(),
            property_keys,
            types: TypeTable::new(),
            functions: Vec::new(),
            layouts: Vec::new(),
            variables: Vec::new(),
            modules: Vec::new(),
            module_failures: Vec::new(),
            lengths: Default::default(),
        };
        tables.lengths.property_keys = 1;
        let ids = [ids_of(&[0], &[], &[])];
        let (table, program_ids) = merge_property_keys(&[tables], &ids, &forward);
        assert_eq!(table.as_slice(), [text_key(0)]);
        assert_eq!(program_ids, [[id(0)]]);
    }
}
