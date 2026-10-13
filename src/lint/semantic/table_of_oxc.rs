//! The order of oxc's hash tables of names.
//!
//! oxc keeps what a scope declares, and the references that resolve to nothing, in hashbrown tables that are keyed by name. Where
//! it goes through such a table, what oxlint prints is in the order of the buckets. That order is a function of the names and of
//! the order in which they came.

/// oxc's `ident_hash` of a name, as far as hashbrown picks the bucket by it.
fn hash(name: &[u8]) -> u32 {
    const SEEDS: (u32, u32) = (0x9E37_79B9, 0x85EB_CA6B);
    let mix = |a: u32, b: u32| {
        let product = u64::from(a) * u64::from(b);
        product as u32 ^ (product >> 32) as u32
    };
    let read = |at: usize| {
        let bytes = name.get(at..at + 4);
        u32::from_le_bytes(bytes.and_then(|it| it.try_into().ok()).unwrap_or_default())
    };
    let byte = |at: usize| name.get(at).copied().map_or(0, u32::from);
    let len = name.len();
    let hash = match len {
        0 => 0,
        1..=3 => {
            let packed = byte(0) << 16 | byte(len / 2) << 8 | byte(len - 1);
            mix(packed ^ SEEDS.0, packed ^ SEEDS.1)
        }
        4..=8 => mix(read(0) ^ SEEDS.0, read(len - 4) ^ SEEDS.1),
        9..=16 => mix(
            read(0) ^ read(len / 2 - 2) ^ SEEDS.0,
            read(len - 4) ^ SEEDS.1,
        ),
        _ => mix(
            read(0) ^ read(len / 3) ^ SEEDS.0,
            read(2 * len / 3) ^ read(len - 4) ^ SEEDS.1,
        ),
    };
    hash ^ (len as u32).rotate_left(16)
}

/// How many buckets hashbrown looks at in one step on x86-64. On arm64 it is 8, so oxlint itself has another order there. What is
/// printed here does not depend on the machine.
const GROUP: usize = 16;

const FREE: u32 = u32::MAX;

/// Puts `place` in the first free bucket that hashbrown finds for `hash`. One is free.
fn put(table: &mut [u32], hash: u32, place: u32) {
    let mask = table.len() - 1;
    let (mut at, mut stride) = (hash as usize & mask, 0);
    loop {
        let mut group = (0..GROUP.min(table.len())).map(|it| (at + it) & mask);
        if let Some(free) = group.find(|&it| table[it] == FREE) {
            table[free] = place;
            return;
        }
        stride += GROUP;
        at = (at + stride) & mask;
    }
}

/// The order in which a table of oxc has `names`, which were put in it in this order, each once, and none was taken out: their
/// places in `names`. The table starts empty and grows as hashbrown's do.
///
/// It is the order of `Scoping::get_bindings` of a scope, with the names in the order in which they are declared, and of
/// `Scoping::root_unresolved_references`, with the names in the order of the first reference to each that resolves to nothing.
pub fn order_in_table_of_oxc<'a>(names: impl Iterator<Item = &'a [u8]>) -> Vec<u32> {
    let hashes: Vec<u32> = names.map(hash).collect();
    order_in_table(&hashes, 0)
}

/// The same for a hashbrown table with any hasher: `hashes` has the low half of the hash of each, in the order in which they were
/// put in. `capacity`: what the table was made with (`with_capacity`, `collect`), 0 for `new`.
pub fn order_in_table(hashes: &[u32], capacity: usize) -> Vec<u32> {
    let buckets_for = |wanted: usize| match wanted {
        0 => 0,
        1..=3 => 4,
        4..=7 => 8,
        wanted => (wanted * 8 / 7).next_power_of_two(),
    };
    let capacity_of = |buckets: usize| match buckets {
        0 => 0,
        1..=8 => buckets - 1,
        _ => buckets / 8 * 7,
    };
    let mut table: Vec<u32> = vec![FREE; buckets_for(capacity)];
    for (count, &hash) in hashes.iter().enumerate() {
        if count == capacity_of(table.len()) {
            let mut grown = vec![FREE; buckets_for(count + 1)];
            for &place in table.iter().filter(|&&it| it != FREE) {
                put(&mut grown, hashes[place as usize], place);
            }
            table = grown;
        }
        put(&mut table, hash, count as u32);
    }
    table.retain(|&it| it != FREE);
    table
}
