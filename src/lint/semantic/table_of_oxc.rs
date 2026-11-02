//! The iteration order of oxc's hash tables of names.
//!
//! oxc stores a scope's bindings, and the unresolved references, in hashbrown tables keyed by name. Wherever it
//! iterates over such a table, oxlint's output is in bucket order. That order is a function of the names and their
//! insertion order.

/// oxc's `ident_hash` of a name, limited to the bits hashbrown picks the bucket by.
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

/// The number of buckets hashbrown probes in one step on x86-64. On arm64 it's 8, so oxlint itself prints a different
/// order there. Our output doesn't depend on the machine.
const GROUP: usize = 16;

const FREE: u32 = u32::MAX;

/// Stores `index` in the first free bucket hashbrown finds for `hash`. The table must have a free bucket.
fn put(table: &mut [u32], hash: u32, index: u32) {
    let mask = table.len() - 1;
    let (mut at, mut stride) = (hash as usize & mask, 0);
    loop {
        let mut group = (0..GROUP.min(table.len())).map(|it| (at + it) & mask);
        if let Some(free) = group.find(|&it| table[it] == FREE) {
            table[free] = index;
            return;
        }
        stride += GROUP;
        at = (at + stride) & mask;
    }
}

/// Returns the iteration order of an oxc table after inserting `names` in this order, each once, with no removals. The
/// result holds indexes into `names`. The table starts empty and grows like hashbrown's.
///
/// This is the order of `Scoping::get_bindings` for a scope, given the names in declaration order, and of
/// `Scoping::root_unresolved_references`, given the names in order of each one's first unresolved reference.
pub fn oxc_table_order<'a>(names: impl Iterator<Item = &'a [u8]>) -> Vec<u32> {
    let hashes: Vec<u32> = names.map(hash).collect();
    hashbrown_table_order(&hashes, 0)
}

/// The same for a hashbrown table with any hasher. `hashes` holds the low half of each key's hash, in insertion order.
/// `capacity` is what the table was created with (`with_capacity`, `collect`), or 0 for `new`.
pub fn hashbrown_table_order(hashes: &[u32], capacity: usize) -> Vec<u32> {
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
            for &index in table.iter().filter(|&&it| it != FREE) {
                put(&mut grown, hashes[index as usize], index);
            }
            table = grown;
        }
        put(&mut table, hash, count as u32);
    }
    table.retain(|&it| it != FREE);
    table
}
