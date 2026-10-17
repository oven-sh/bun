use bun_collections::hashbrown::HashSet;

pub const FILE_NAME: &str = "index-of-the-compiled-program";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Entry {
    File,
    JsonModule,
    Folder,
}

const SLOT_SIZE: usize = 8;

fn read_slot(index: &[u8], slot: usize) -> (u32, u32) {
    let at = slot * SLOT_SIZE;
    let word =
        |at: usize| u32::from_le_bytes([index[at], index[at + 1], index[at + 2], index[at + 3]]);
    (word(at), word(at + 4))
}

pub fn build(sorted_paths: &[u8], is_json_module: impl Fn(&[u8]) -> bool) -> Vec<u8> {
    let mut keys: Vec<(u32, u32)> = Vec::new();
    let mut folders: HashSet<&[u8], bun_wyhash::BuildHasher> = HashSet::default();
    let mut offset = 0usize;
    for path in bun_core::strings::split(sorted_paths, b"\n") {
        if !path.is_empty() {
            let is_json = is_json_module(path);
            keys.push((offset as u32 + 1, (path.len() as u32) << 2 | is_json as u32));
            let mut folder = path;
            while !is_json
                && let Some(at) = bun_core::strings::last_index_of_char(folder, bun_paths::SEP)
            {
                folder = &folder[..at];
                if folder.is_empty() || !folders.insert(folder) {
                    break;
                }
                keys.push((offset as u32 + 1, (at as u32) << 2 | 2));
            }
        }
        offset += path.len() + 1;
    }
    let capacity = (keys.len() * 2).next_power_of_two();
    let mut index = vec![0u8; capacity * SLOT_SIZE];
    for (start, packed) in keys {
        let key = &sorted_paths[start as usize - 1..][..(packed >> 2) as usize];
        let mut slot = bun_wyhash::hash(key) as usize & (capacity - 1);
        while read_slot(&index, slot).0 != 0 {
            slot = (slot + 1) & (capacity - 1);
        }
        index[slot * SLOT_SIZE..][..4].copy_from_slice(&start.to_le_bytes());
        index[slot * SLOT_SIZE + 4..][..4].copy_from_slice(&packed.to_le_bytes());
    }
    index
}

pub fn find<'a>(index: &[u8], sorted_paths: &'a [u8], key: &[u8]) -> Option<(&'a [u8], Entry)> {
    let capacity = index.len() / SLOT_SIZE;
    if capacity == 0 {
        return None;
    }
    let mut slot = bun_wyhash::hash(key) as usize & (capacity - 1);
    loop {
        let (start, packed) = read_slot(index, slot);
        if start == 0 {
            return None;
        }
        let found = sorted_paths
            .get(start as usize - 1..)?
            .get(..(packed >> 2) as usize)?;
        if found == key {
            return Some((
                found,
                match packed & 3 {
                    0 => Entry::File,
                    1 => Entry::JsonModule,
                    _ => Entry::Folder,
                },
            ));
        }
        slot = (slot + 1) & (capacity - 1);
    }
}
