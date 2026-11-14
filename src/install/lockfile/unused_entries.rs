//! An entry of the `packages` object of bun.lock is used if the lookup of a dependency of the root, of a workspace or of a used entry stops at it. The loader leaves out the other entries.

use core::fmt::Write as _;

use bun_collections::{DynamicBitSet, HashMap, IdentityContext, index_sort};
use bun_semver::semver_string::Builder as StringBuilder;

use super::{DependencySlice, JSON, PkgMap, PkgPathSet, name_start};
use crate::dependency::Dependency;
use crate::{DependencyID, PackageID, invalid_package_id};

/// The value of a key of `packages`: its package, and the entry that has the key.
#[derive(Clone, Copy, Default)]
pub(super) struct Slot {
    pub(super) id: PackageID,
    pub(super) entry: u32,
}

impl Slot {
    /// The name of a workspace is a key before an entry has it.
    pub(super) const NO_ENTRY: u32 = u32::MAX;

    pub(super) fn of_workspace(id: PackageID) -> Slot {
        Slot {
            id,
            entry: Slot::NO_ENTRY,
        }
    }
}

/// An entry of `packages` that is not the first one of its package, with its own dependency list.
#[derive(Clone, Copy)]
pub(super) struct Repeat {
    pub(super) entry: u32,
    pub(super) package: PackageID,
    pub(super) list: DependencySlice,
}

/// Which entries of `packages` are used. bun writes no other entry: see `Unused`.
pub(super) struct Reach {
    pub(super) used: Vec<bool>,
    unused: usize,
    /// Used entries that made their lookups before they were used.
    pending: Vec<u32>,
    /// Those lookups of an entry are `targets[starts[entry]..starts[entry + 1]]`.
    starts: Vec<u32>,
    targets: Vec<u32>,
    /// Peers that were bound by version, in the order of the entries. They are looked up by name only if an entry is unused.
    pub(super) peers: Vec<(u32, DependencyID)>,
}

impl Reach {
    pub(super) fn init(entries: usize, left_out: Option<&DynamicBitSet>) -> Reach {
        let mut used = vec![false; entries];
        let mut unused = entries;
        if let Some(left_out) = left_out {
            // An entry that this load leaves out does not count as unused a second time.
            let mut left_out = left_out.iterator::<true, true>();
            while let Some(entry) = left_out.next() {
                used[entry] = true;
                unused -= 1;
            }
        }
        Reach {
            used,
            unused,
            pending: Vec::new(),
            starts: Vec::with_capacity(entries + 1),
            targets: Vec::with_capacity(entries),
            peers: Vec::new(),
        }
    }

    /// Marks `entry` as used. Returns true if it was unused.
    #[inline]
    pub(super) fn mark(&mut self, entry: u32) -> bool {
        let is_used = &mut self.used[entry as usize];
        if *is_used {
            return false;
        }
        *is_used = true;
        self.unused -= 1;
        if (entry as usize) + 1 < self.starts.len() {
            self.pending.push(entry);
        }
        true
    }

    #[inline]
    pub(super) fn mark_slot(&mut self, slot: Slot) -> bool {
        slot.entry != Slot::NO_ENTRY && self.mark(slot.entry)
    }

    pub(super) fn is_used(&self, slot: Slot) -> bool {
        slot.entry != Slot::NO_ENTRY && self.used[slot.entry as usize]
    }

    /// The lookups that follow are those of the next entry in the file.
    #[inline]
    pub(super) fn next_entry(&mut self) {
        self.starts.push(self.targets.len() as u32);
    }

    /// A lookup of the entry that has its turn stopped at `slot`. It counts once that entry is used.
    #[inline]
    pub(super) fn stop_at(&mut self, slot: Slot, is_used: bool) {
        if is_used {
            self.mark_slot(slot);
        } else if slot.entry != Slot::NO_ENTRY {
            self.targets.push(slot.entry);
        }
    }

    /// Takes an entry that became used after its turn, and counts the lookups of its turn. Every entry had its turn.
    #[inline]
    fn next_used(&mut self) -> Option<u32> {
        let entry = self.pending.pop()?;
        for at in self.starts[entry as usize]..self.starts[entry as usize + 1] {
            let target = self.targets[at as usize];
            let is_used = &mut self.used[target as usize];
            if !*is_used {
                *is_used = true;
                self.unused -= 1;
                self.pending.push(target);
            }
        }
        Some(entry)
    }

    /// Counts the lookups of the entries that became used after their turn. Returns true if no entry is unused then.
    pub(super) fn follow(&mut self) -> bool {
        while self.next_used().is_some() {}
        self.unused == 0
    }
}

/// Returns true if two values of `packages` are the same apart from whitespace.
fn same_value(a: &JSON::E::JsonValue, b: &JSON::E::JsonValue) -> bool {
    use JSON::E::JsonValue;
    match (a, b) {
        (JsonValue::Null, JsonValue::Null) => true,
        (JsonValue::Boolean(a), JsonValue::Boolean(b)) => a == b,
        (JsonValue::Number(a), JsonValue::Number(b)) => a.value() == b.value(),
        (JsonValue::String(a), JsonValue::String(b)) => a.slice() == b.slice(),
        (JsonValue::Array(a), JsonValue::Array(b)) => {
            let (a, b) = (a.get().items(), b.get().items());
            a.len() == b.len() && a.iter().zip(b.iter()).all(|(a, b)| same_value(a, b))
        }
        (JsonValue::Object(a), JsonValue::Object(b)) => {
            let (a, b) = (a.get().properties(), b.get().properties());
            a.len() == b.len()
                && (a.iter().zip(b.iter()))
                    .all(|(a, b)| a.key.slice() == b.key.slice() && same_value(&a.value, &b.value))
        }
        _ => false,
    }
}

/// The entries that no lookup stops at.
pub(super) enum Unused {
    /// Each one repeats a used entry of its package, so these packages bind once more without them.
    Repeats {
        entries: DynamicBitSet,
        packages: DynamicBitSet,
    },
    /// The file is loaded again without them.
    Others(DynamicBitSet),
}

/// What `load_entries` did with the entries that no lookup stops at.
pub(super) enum Loaded {
    /// The load is complete. These entries repeat a used one or were left out.
    Done(Option<DynamicBitSet>),
    /// Nothing is loaded: the file has to be loaded again without these.
    AgainWithout(DynamicBitSet),
}

/// The entries that are not bundled and are below the folder of an unused entry of their name, for `Lookups::go_on_above`.
struct Beside {
    /// The hash of the folder of each one and the entry, in increasing order. Two folders can have one hash.
    entries: Vec<(u64, u32)>,
    /// True for an entry once its folder holds a used bundled entry.
    active: Vec<bool>,
}

impl Beside {
    fn first_of(&self, folder_hash: u64) -> usize {
        (self.entries).partition_point(|&(other, _)| other < folder_hash)
    }

    fn has(&self, folder_hash: u64) -> bool {
        (self.entries.get(self.first_of(folder_hash)))
            .is_some_and(|&(other, _)| other == folder_hash)
    }
}

/// What the lookups that the turns left out read and keep.
struct LeftOut {
    /// How many entries of each name are unused, or used and not taken from `Reach::next_used` yet.
    names: HashMap<u64, u32, IdentityContext<u64>>,
    peers: Vec<(u32, DependencyID)>,
    /// The repeats that list other dependencies than their package has, in the order of the entries.
    own_lists: Vec<Repeat>,
    /// It is there once the entries that stay unused without it are known.
    beside: Option<Beside>,
}

/// The lookups that the turns of the entries leave out.
pub(super) struct Lookups<'a> {
    pub(super) rows: &'a [JSON::E::PropertyJSON],
    pub(super) map: &'a PkgMap<Slot>,
    pub(super) bundled: &'a PkgPathSet,
    /// The package of each entry that has its key.
    pub(super) keyed: &'a [PackageID],
    pub(super) repeats: &'a [Repeat],
    /// The dependency list of each package, which its first entry gives it.
    pub(super) lists: &'a [DependencySlice],
    pub(super) members: core::ops::Range<PackageID>,
    pub(super) dependencies: &'a [Dependency],
    pub(super) string_buf: &'a [u8],
}

impl Lookups<'_> {
    pub(super) fn key_of(&self, entry: u32) -> &[u8] {
        self.rows[entry as usize].key.slice()
    }

    /// Returns true if the two lists have the same names, and `same` is true for each pair.
    fn same_lists(
        &self,
        a: DependencySlice,
        b: DependencySlice,
        same: impl Fn(&Dependency, &Dependency) -> bool,
    ) -> bool {
        a.len == b.len
            && (a.begin()..a.end()).zip(b.begin()..b.end()).all(|(a, b)| {
                let (a, b) = (
                    &self.dependencies[a as usize],
                    &self.dependencies[b as usize],
                );
                a.name_hash == b.name_hash && same(a, b)
            })
    }

    /// Returns the entries that stay unused, if there is one.
    pub(super) fn unused_entries(
        &self,
        reach: &mut Reach,
        path_buf: &mut [u8],
    ) -> Result<Option<Unused>, bun_alloc::AllocError> {
        let mut left_out = LeftOut {
            names: HashMap::default(),
            peers: core::mem::take(&mut reach.peers),
            own_lists: (self.repeats.iter())
                .filter(|repeat| {
                    // The lookup of a dependency depends on its name and on whether it is an optional peer.
                    !self.same_lists(repeat.list, self.lists[repeat.package as usize], |a, b| {
                        a.behavior.is_optional_peer() == b.behavior.is_optional_peer()
                    })
                })
                .copied()
                .collect(),
            beside: None,
        };
        for entry in 0..self.rows.len() as u32 {
            if !reach.used[entry as usize]
                && let Some(name) = self.name_hash_of(entry)
            {
                *left_out.names.get_or_put(name)?.value_ptr += 1;
            }
        }

        for at in 0..left_out.peers.len() {
            let (entry, dep_id) = left_out.peers[at];
            if reach.used[entry as usize] {
                self.look_up_peer(reach, &left_out.names, entry, dep_id, path_buf);
                self.look_up_for_used(reach, &mut left_out, path_buf);
            }
        }
        for at in 0..left_out.own_lists.len() {
            let repeat = left_out.own_lists[at];
            if reach.used[repeat.entry as usize] {
                self.look_up_own_list(reach, &repeat, path_buf);
                self.look_up_for_used(reach, &mut left_out, path_buf);
            }
        }
        if reach.unused != 0 && !self.bundled.map.is_empty() {
            self.go_on_above_from_unused(reach, path_buf)?;
            self.look_up_for_used(reach, &mut left_out, path_buf);
        }
        if reach.unused != 0 && !self.bundled.map.is_empty() {
            let mut beside = self.beside(reach, &left_out.names)?;
            if !beside.entries.is_empty() {
                for bundled in self.bundled.map.keys() {
                    if let Ok(name @ 1..) = name_start(bundled)
                        && beside.has(bun_wyhash::hash(&bundled[..name - 1]))
                        && let Some(&slot) = self.map.get(bundled)
                        && reach.is_used(slot)
                    {
                        self.go_on_above_folder(reach, &mut beside, &bundled[..name - 1], path_buf);
                    }
                }
                left_out.beside = Some(beside);
                self.look_up_for_used(reach, &mut left_out, path_buf);
            }
        }
        if reach.unused == 0 {
            return Ok(None);
        }

        let mut unused = DynamicBitSet::init_empty(self.rows.len())?;
        for entry in 0..self.rows.len() {
            if !reach.used[entry] {
                unused.set(entry);
            }
        }
        self.classify(unused, reach).map(Some)
    }

    fn name_hash_of(&self, entry: u32) -> Option<u64> {
        let key = self.key_of(entry);
        let name = name_start(key).ok()?;
        Some(StringBuilder::string_hash(&key[name..]))
    }

    /// Each entry that became used makes the lookups that its turn left out. It does so once, so the work grows with the file and not with its square.
    fn look_up_for_used(&self, reach: &mut Reach, left_out: &mut LeftOut, path_buf: &mut [u8]) {
        let LeftOut {
            names,
            peers,
            own_lists,
            beside,
        } = left_out;
        while let Some(entry) = reach.next_used() {
            if let Some(name) = self.name_hash_of(entry)
                && let Some(unused) = names.get_mut(&name)
            {
                *unused -= 1;
            }
            let from = peers.partition_point(|&(peer_of, _)| peer_of < entry);
            for &(peer_of, dep_id) in &peers[from..] {
                if peer_of != entry {
                    break;
                }
                self.look_up_peer(reach, names, entry, dep_id, path_buf);
            }
            if let Ok(at) = own_lists.binary_search_by_key(&entry, |repeat| repeat.entry) {
                self.look_up_own_list(reach, &own_lists[at], path_buf);
            }
            if let Some(beside) = beside {
                self.go_on_above(reach, beside, entry, path_buf);
            }
        }
    }

    /// Looks up by name a peer of a used entry that was bound by version.
    fn look_up_peer(
        &self,
        reach: &mut Reach,
        names: &HashMap<u64, u32, IdentityContext<u64>>,
        entry: u32,
        dep_id: DependencyID,
        path_buf: &mut [u8],
    ) {
        let dep = &self.dependencies[dep_id as usize];
        let name = dep.name.slice(self.string_buf);
        if names.get(&dep.name_hash).is_some_and(|unused| *unused > 0)
            && let Some(slot) = self.stops_at(self.key_of(entry), name, path_buf, None)
        {
            reach.mark_slot(slot);
        }
    }

    /// The entry that the lookup of `name` from the package at `key` stops at. The turns have their own copy of the walk.
    #[inline(never)]
    fn stops_at(
        &self,
        key: &[u8],
        name: &[u8],
        path_buf: &mut [u8],
        bundled: Option<&PkgPathSet>,
    ) -> Option<Slot> {
        let (slot, _) = self.map.find(key, name, path_buf, bundled).ok()?;
        Some(*slot)
    }

    /// A used entry that lists other dependencies than its package has looks its own up too, so a copy that is listed first hides none.
    fn look_up_own_list(&self, reach: &mut Reach, repeat: &Repeat, path_buf: &mut [u8]) {
        for dep_id in repeat.list.begin()..repeat.list.end() {
            let dep = &self.dependencies[dep_id as usize];
            let name = dep.name.slice(self.string_buf);
            let bundled = dep.behavior.is_optional_peer().then_some(self.bundled);
            if let Some(slot) = self.stops_at(self.key_of(repeat.entry), name, path_buf, bundled) {
                reach.mark_slot(slot);
            }
        }
    }

    /// What `go_on_above` does, from the side of the unused entries: they are few in a file that bun wrote. It finds most of them, with at most one probe for each entry of the file.
    fn go_on_above_from_unused(
        &self,
        reach: &mut Reach,
        path_buf: &mut [u8],
    ) -> Result<(), bun_alloc::AllocError> {
        let mut seen: HashMap<u64, (), IdentityContext<u64>> = HashMap::default();
        let mut folders: Vec<&[u8]> = Vec::new();
        for bundled in self.bundled.map.keys() {
            if let Ok(name @ 1..) = name_start(bundled)
                && (self.map.get(bundled)).is_some_and(|slot| reach.is_used(*slot))
                && !seen
                    .get_or_put(bun_wyhash::hash(&bundled[..name - 1]))?
                    .found_existing
            {
                folders.push(&bundled[..name - 1]);
            }
        }
        index_sort::sort_slice_unstable(&mut folders);

        let mut probes = self.rows.len();
        for entry in 0..self.rows.len() as u32 {
            let key = self.key_of(entry);
            if reach.used[entry as usize] {
                continue;
            }
            let Ok(name) = name_start(key) else {
                continue;
            };
            // `below` is `<folder>/` or empty, so the folders that start with it are below the entry.
            let (below, name) = key.split_at(name);
            let from = folders.partition_point(|folder| *folder < below);
            for folder in &folders[from..] {
                let end = folder.len() + 1 + name.len();
                if !folder.starts_with(below) || reach.used[entry as usize] {
                    break;
                }
                if probes == 0 {
                    return Ok(());
                }
                probes -= 1;
                if end > path_buf.len() {
                    continue;
                }
                path_buf[..folder.len()].copy_from_slice(folder);
                path_buf[folder.len()] = b'/';
                path_buf[folder.len() + 1..end].copy_from_slice(name);
                let beside = &path_buf[..end];
                if (self.map.get(beside)).is_some_and(|slot| reach.is_used(*slot))
                    && !self.bundled.contains(beside)
                {
                    self.look_up_above(reach, folder, name, path_buf);
                }
            }
        }
        Ok(())
    }

    fn beside(
        &self,
        reach: &Reach,
        names: &HashMap<u64, u32, IdentityContext<u64>>,
    ) -> Result<Beside, bun_alloc::AllocError> {
        // FNV-1a, because it gives the hash of each part that a key starts with in one pass over the key.
        const START: u64 = 0xcbf2_9ce4_8422_2325;
        let add = |hash: u64, byte: u8| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);

        // Each unused entry, as one number for its name and the part of its key before the name.
        let mut unused: HashMap<u64, (), IdentityContext<u64>> = HashMap::default();
        for entry in 0..self.rows.len() as u32 {
            let key = self.key_of(entry);
            if !reach.used[entry as usize]
                && let Ok(name) = name_start(key)
            {
                let before = key[..name]
                    .iter()
                    .fold(START, |hash, &byte| add(hash, byte));
                unused.put(before ^ StringBuilder::string_hash(&key[name..]), ())?;
            }
        }

        let mut entries: Vec<(u64, u32)> = Vec::new();
        for entry in 0..self.rows.len() as u32 {
            let key = self.key_of(entry);
            if self.keyed[entry as usize] == invalid_package_id {
                continue;
            }
            let Ok(name @ 1..) = name_start(key) else {
                continue;
            };
            let hash = StringBuilder::string_hash(&key[name..]);
            if !names.get(&hash).is_some_and(|unused| *unused > 0) {
                continue;
            }
            // The lookup above the folder of this entry stops at an entry of its name in the root or in a folder that the key starts with.
            let mut before = START;
            let mut is_below_one = unused.contains(&(before ^ hash));
            for &byte in &key[..name - 1] {
                if is_below_one {
                    break;
                }
                before = add(before, byte);
                is_below_one = byte == b'/' && unused.contains(&(before ^ hash));
            }
            if is_below_one && !self.bundled.contains(key) {
                entries.push((bun_wyhash::hash(&key[..name - 1]), entry));
            }
        }
        entries.sort_unstable();
        Ok(Beside {
            active: vec![false; entries.len()],
            entries,
        })
    }

    /// A lookup that stops beside a used bundled entry goes on above their folder: bun writes the dependency of a bundled package there.
    fn go_on_above(&self, reach: &mut Reach, beside: &mut Beside, entry: u32, path_buf: &mut [u8]) {
        let key = self.key_of(entry);
        let Ok(name @ 1..) = name_start(key) else {
            return;
        };
        let folder = &key[..name - 1];
        if self.bundled.contains(key) {
            self.go_on_above_folder(reach, beside, folder, path_buf);
        } else if let Ok(at) = (beside.entries).binary_search(&(bun_wyhash::hash(folder), entry))
            && beside.active[at]
        {
            self.look_up_above(reach, folder, &key[name..], path_buf);
        }
    }

    /// `folder` holds a used bundled entry.
    fn go_on_above_folder(
        &self,
        reach: &mut Reach,
        beside: &mut Beside,
        folder: &[u8],
        path_buf: &mut [u8],
    ) {
        let hash = bun_wyhash::hash(folder);
        for at in beside.first_of(hash)..beside.entries.len() {
            let (other_hash, other) = beside.entries[at];
            if other_hash != hash {
                break;
            }
            let key = self.key_of(other);
            if !beside.active[at]
                && let Ok(name @ 1..) = name_start(key)
                && key[..name - 1] == *folder
            {
                beside.active[at] = true;
                if reach.used[other as usize] {
                    self.look_up_above(reach, folder, &key[name..], path_buf);
                }
            }
        }
    }

    fn look_up_above(&self, reach: &mut Reach, folder: &[u8], name: &[u8], path_buf: &mut [u8]) {
        let above = match name_start(folder) {
            Ok(0) => self.map.get(name).copied(),
            Ok(at) => self.stops_at(&folder[..at - 1], name, path_buf, None),
            Err(_) => None,
        };
        if let Some(slot) = above {
            reach.mark_slot(slot);
        }
    }

    /// Tells if each unused entry only repeats a used entry of its package.
    fn classify(
        &self,
        unused: DynamicBitSet,
        reach: &Reach,
    ) -> Result<Unused, bun_alloc::AllocError> {
        let mut by_package = self.repeats.to_vec();
        index_sort::sort_slice_unstable_by_key(&mut by_package, |repeat| {
            (repeat.package, repeat.entry)
        });
        let first_used_repeat = |package: PackageID| {
            let from = by_package.partition_point(|repeat| repeat.package < package);
            (by_package[from..].iter())
                .take_while(|repeat| repeat.package == package)
                .find(|repeat| reach.used[repeat.entry as usize])
        };

        let mut packages = DynamicBitSet::init_empty(self.lists.len())?;
        let mut entries = unused.iterator::<true, true>();
        while let Some(entry) = entries.next() {
            let package = self.keyed[entry];
            // The first entry of a package gives the package its fields and its dependency list.
            let is_first = (self.repeats)
                .binary_search_by_key(&(entry as u32), |repeat| repeat.entry)
                .is_err();
            let repeats_used = || {
                first_used_repeat(package).is_some_and(|used| {
                    self.same_lists(self.lists[package as usize], used.list, |a, b| {
                        a.behavior == b.behavior
                    }) && same_value(
                        &self.rows[entry].value,
                        &self.rows[used.entry as usize].value,
                    )
                })
            };
            // An entry of the root or of a workspace repeats no entry.
            if package == 0 || self.members.contains(&package) || (is_first && !repeats_used()) {
                return Ok(Unused::Others(unused));
            }
            packages.set(package as usize);
        }
        Ok(Unused::Repeats {
            entries: unused,
            packages,
        })
    }
}

pub(super) fn warn_unused(rows: &[JSON::E::PropertyJSON], unused: &DynamicBitSet) {
    let mut list = std::string::String::new();
    let mut count: usize = 0;
    let mut entries = unused.iterator::<true, true>();
    while let Some(entry) = entries.next() {
        count += 1;
        if count <= 5 {
            let key = bun_core::fmt::escape_control_chars(rows[entry].key.slice());
            let _ = write!(list, "{}\"{key}\"", if count > 1 { ", " } else { "" });
        }
    }
    if count > 5 {
        let _ = write!(list, " and {} more", count - 5);
    }
    bun_core::warn!(
        "skipping {} unused bun.lock {}: {}",
        count,
        if count == 1 { "entry" } else { "entries" },
        list,
    );
}
