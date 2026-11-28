//! The store of test input records: one per record directory, so a suite's records are tens of
//! megabytes instead of one JSON file per test file that repeats the same resolutions and modules.
//!
//! What a test file's pass depended on is a list of entries: resolutions (the question and the
//! `check` of its answer), modules and answer files (path and content hash) and own reads (look,
//! path, what else the look needs, value). Test files of one suite share most of them, so the store
//! keeps one table of strings and one of entries, and per test file a few states: the fingerprint of
//! the run, the outcome and what else the record says, and one list of entry ids per kind.
//!
//! Lookup is in two steps. The first key, the fingerprint of the run and the test file's path, gives
//! the candidate states. Every entry carries its recorded value, so a state's lists are its second
//! key: they hold on the current tree when looking at each entry again gives the value it carries,
//! and then the state names the result. Each entry is looked at again once per run, however many
//! states list it. A file keeps its last [`STATES_PER_FILE`] distinct states, so going to a failing
//! state and back finds the old pass.
//!
//! On disk, `<dir>/store.btis` is the merged store, and `<dir>/segments/` holds one file per process
//! that recorded since. A process appends one chunk per test file to its own segment and holds an
//! exclusive `flock` on it while it lives. At the end of a run, the process that started it merges:
//! under an exclusive lock of `<dir>/store.lock` it reads the store and every segment it can lock
//! (its writer has exited, or crashed), writes the merged store to a temporary file, renames it over
//! `store.btis`, and only then removes those segments. Loading takes the same lock shared, so it sees
//! the store and segments of one moment. A torn chunk at the end of a segment fails its length or
//! checksum and is ignored with what follows it, so a killed writer loses only its last file.
//!
//! Every file starts with `BTIS` and [`STORE_VERSION`]; a file of another version is ignored, and
//! the next merge replaces it.

use bun_collections::HashMap;
use bun_paths::Path;
use bun_sys::{FileLockMode, O};

/// 2: paths are relative to the record root (the repository) instead of the project directory.
pub const STORE_VERSION: u32 = 2;
const MAGIC: &[u8; 4] = b"BTIS";
/// How many distinct input states of one test file the store keeps, newest first.
pub const STATES_PER_FILE: usize = 4;
pub const STORE_FILE: &str = "store.btis";
const LOCK_FILE: &str = "store.lock";
const SEGMENTS: &str = "segments";

/// The kinds of entries, in the order a state lists them.
pub const RESOLUTION: u8 = 0;
pub const MODULE: u8 = 1;
pub const ANSWER: u8 = 2;
pub const READ: u8 = 3;

pub const IMPORTER_IS_FILE: u32 = 1;
pub const SPECIFIER_FROM_ROOT: u32 = 2;
pub const IMPORTER_FROM_ROOT: u32 = 4;
pub const PLUGIN: u32 = 8;
pub const HAS_CHECK: u32 = 16;

pub const HAS_SHA: u32 = 1;
pub const VIRTUAL: u32 = 2;
pub const CHANGED_DURING_RUN: u32 = 4;
pub const HAS_AOT: u32 = 8;

/// An entry as the recorder hands it over: strings as records write them, paths under the root
/// relative to it.
pub enum Entry {
    Resolution {
        flags: u32,
        kind: Box<[u8]>,
        specifier: Box<[u8]>,
        importer: Box<[u8]>,
        /// With whether each was made relative to the root.
        paths: Vec<(Box<[u8]>, bool)>,
        check: Option<[u8; 32]>,
    },
    Module {
        flags: u32,
        path: Box<[u8]>,
        sha256: Option<[u8; 32]>,
        aot: Option<[u8; 32]>,
    },
    Answer {
        path: Box<[u8]>,
        sha256: Option<[u8; 32]>,
    },
    Read {
        look: &'static str,
        path: Box<[u8]>,
        extra: Box<[u8]>,
        value: Box<[u8]>,
    },
}

impl Entry {
    fn kind(&self) -> u8 {
        match self {
            Entry::Resolution { .. } => RESOLUTION,
            Entry::Module { .. } => MODULE,
            Entry::Answer { .. } => ANSWER,
            Entry::Read { .. } => READ,
        }
    }
}

/// What a record says besides its inputs.
#[derive(Clone, Default)]
pub struct Header<S> {
    /// pass, fail, skip, todo, expectations, unhandledErrors; `None` when the file failed before its tests.
    pub outcome: Option<[u32; 6]>,
    pub unattributed_before: u32,
    pub late_from_earlier_files: u32,
    pub marks: Vec<S>,
}

/// One test file's pass, as the recorder appends it.
pub struct NewState<'a> {
    pub file: &'a [u8],
    pub fingerprint: [u8; 32],
    pub header: Header<Box<[u8]>>,
    pub entries: &'a [Entry],
}

/// A state in the store: strings and entries by id.
#[derive(Clone)]
pub struct State {
    pub file: u32,
    pub fingerprint: [u8; 32],
    /// Nanoseconds since the epoch when it was written.
    pub time: u64,
    pub header: Header<u32>,
    /// Entry ids by kind: [`RESOLUTION`], [`MODULE`], [`ANSWER`], [`READ`].
    pub lists: [Vec<u32>; 4],
}

/// An entry of the store, decoded.
pub enum EntryView<'a> {
    Resolution {
        flags: u32,
        kind: &'a [u8],
        specifier: &'a [u8],
        importer: &'a [u8],
        paths: Vec<(&'a [u8], bool)>,
        check: Option<&'a [u8; 32]>,
    },
    Module {
        flags: u32,
        path: &'a [u8],
        sha256: Option<&'a [u8; 32]>,
        aot: Option<&'a [u8; 32]>,
    },
    Answer {
        path: &'a [u8],
        sha256: Option<&'a [u8; 32]>,
    },
    Read {
        look: &'a [u8],
        path: &'a [u8],
        extra: &'a [u8],
        value: &'a [u8],
    },
}

#[derive(Default)]
pub struct Store {
    pub strings: Vec<Box<[u8]>>,
    string_ids: HashMap<Box<[u8]>, u32>,
    /// Encoded with ids of `strings`.
    pub entries: Vec<Box<[u8]>>,
    entry_ids: HashMap<Box<[u8]>, u32>,
    pub states: Vec<State>,
    /// Bytes read from disk, and how many segments.
    pub bytes: u64,
    pub segments: usize,
    /// Files of another store version: ignored.
    pub other_format: usize,
}

// ── Encoding ──

fn put_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn varint(input: &mut &[u8]) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let (&byte, rest) = input.split_first()?;
        *input = rest;
        value |= u64::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Some(value);
        }
    }
    None
}

fn id(input: &mut &[u8]) -> Option<u32> {
    u32::try_from(varint(input)?).ok()
}

fn take<'a>(input: &mut &'a [u8], n: usize) -> Option<&'a [u8]> {
    if input.len() < n {
        return None;
    }
    let (head, rest) = input.split_at(n);
    *input = rest;
    Some(head)
}

fn hash32<'a>(input: &mut &'a [u8]) -> Option<&'a [u8; 32]> {
    take(input, 32)?.try_into().ok()
}

/// Reads one encoded entry from `input` and writes it to `out` with every string id passed through `map`.
fn remap_entry(
    input: &mut &[u8],
    out: &mut Vec<u8>,
    map: &mut impl FnMut(u32) -> Option<u32>,
) -> Option<()> {
    let mut sid = |input: &mut &[u8], out: &mut Vec<u8>| -> Option<()> {
        put_varint(out, u64::from(map(id(input)?)?));
        Some(())
    };
    let (&kind, rest) = input.split_first()?;
    *input = rest;
    out.push(kind);
    match kind {
        RESOLUTION => {
            let flags = id(input)?;
            put_varint(out, u64::from(flags));
            for _ in 0..3 {
                sid(input, out)?;
            }
            let n = id(input)?;
            put_varint(out, u64::from(n));
            for _ in 0..n {
                sid(input, out)?;
                out.extend_from_slice(take(input, 1)?);
            }
            if flags & HAS_CHECK != 0 {
                out.extend_from_slice(take(input, 32)?);
            }
        }
        MODULE | ANSWER => {
            let flags = id(input)?;
            put_varint(out, u64::from(flags));
            sid(input, out)?;
            if flags & HAS_SHA != 0 {
                out.extend_from_slice(take(input, 32)?);
            }
            if flags & HAS_AOT != 0 {
                out.extend_from_slice(take(input, 32)?);
            }
        }
        READ => {
            for _ in 0..4 {
                sid(input, out)?;
            }
        }
        _ => return None,
    }
    Some(())
}

fn put_state(out: &mut Vec<u8>, state: &State) {
    put_varint(out, u64::from(state.file));
    out.extend_from_slice(&state.fingerprint);
    put_varint(out, state.time);
    match state.header.outcome {
        Some(counts) => {
            out.push(1);
            for count in counts {
                put_varint(out, u64::from(count));
            }
        }
        None => out.push(0),
    }
    put_varint(out, u64::from(state.header.unattributed_before));
    put_varint(out, u64::from(state.header.late_from_earlier_files));
    put_varint(out, state.header.marks.len() as u64);
    for &mark in &state.header.marks {
        put_varint(out, u64::from(mark));
    }
    for list in &state.lists {
        put_varint(out, list.len() as u64);
        for &entry in list {
            put_varint(out, u64::from(entry));
        }
    }
}

/// Reads a state with its string and entry ids passed through the maps.
fn get_state(
    input: &mut &[u8],
    strings: &mut impl FnMut(u32) -> Option<u32>,
    entries: &mut impl FnMut(u32) -> Option<u32>,
) -> Option<State> {
    let file = strings(id(input)?)?;
    let fingerprint = *hash32(input)?;
    let time = varint(input)?;
    let outcome = match take(input, 1)?[0] {
        0 => None,
        _ => {
            let mut counts = [0u32; 6];
            for count in &mut counts {
                *count = id(input)?;
            }
            Some(counts)
        }
    };
    let unattributed_before = id(input)?;
    let late_from_earlier_files = id(input)?;
    let mut marks = Vec::new();
    for _ in 0..id(input)? {
        marks.push(strings(id(input)?)?);
    }
    let mut lists: [Vec<u32>; 4] = Default::default();
    for list in &mut lists {
        let n = id(input)? as usize;
        list.reserve(n.min(input.len()));
        for _ in 0..n {
            list.push(entries(id(input)?)?);
        }
    }
    Some(State {
        file,
        fingerprint,
        time,
        header: Header {
            outcome,
            unattributed_before,
            late_from_earlier_files,
            marks,
        },
        lists,
    })
}

/// A chunk: length and checksum of the payload, then the payload.
fn put_chunk(out: &mut Vec<u8>, payload: &[u8]) {
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&bun_wyhash::hash32(payload).to_le_bytes());
    out.extend_from_slice(payload);
}

fn file_header(out: &mut Vec<u8>) {
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&STORE_VERSION.to_le_bytes());
}

// ── Files and locks ──

/// `flock`; `false` when `nonblocking` and it is held elsewhere, or on an error.
fn lock(file: &bun_sys::File, mode: FileLockMode, nonblocking: bool) -> bool {
    bun_sys::flock(file.fd(), mode, nonblocking).unwrap_or(false)
}

fn open_lock(dir: &[u8]) -> Option<bun_sys::File> {
    let flags = O::RDWR | O::CREAT | O::CLOEXEC;
    bun_sys::File::open(
        &Path::from_parts(&[dir, LOCK_FILE.as_bytes()]),
        flags,
        0o666,
    )
    .ok()
}

fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |it| it.as_nanos() as u64)
}

// ── Writing ──

/// The segment this process appends to. Ids are local to it and grow with each chunk.
pub struct Segment {
    file: bun_sys::File,
    strings: HashMap<Box<[u8]>, u32>,
    entries: HashMap<Box<[u8]>, u32>,
    /// A write failed: what follows would refer to ids a reader never sees.
    broken: bool,
}

impl Segment {
    pub fn open(dir: &[u8]) -> bun_sys::Result<Segment> {
        let segments = Path::from_parts(&[dir, SEGMENTS.as_bytes()]);
        bun_sys::mkdir_recursive(&segments)?;
        let name = format!("{}-{}", std::process::id(), now_ns());
        let new = Path::from_parts(&[&segments, format!("{name}.new").as_bytes()]);
        let flags = O::WRONLY | O::CREAT | O::EXCL | O::APPEND | O::CLOEXEC;
        let file = bun_sys::File::open(&new, flags, 0o666)?;
        // Held until the process exits, so a merge leaves the segment alone while it can still grow.
        // Taken before the segment has the name a merge looks for.
        lock(&file, FileLockMode::Exclusive, true);
        let mut header = Vec::with_capacity(8);
        file_header(&mut header);
        file.write_all(&header)?;
        bun_sys::rename(
            &new,
            &Path::from_parts(&[&segments, format!("{name}.seg").as_bytes()]),
        )?;
        Ok(Segment {
            file,
            strings: HashMap::new(),
            entries: HashMap::new(),
            broken: false,
        })
    }

    /// One chunk: the strings and entries this segment has not had yet, and the state.
    pub fn append(&mut self, state: &NewState<'_>) -> bun_sys::Result<()> {
        if self.broken {
            return Ok(());
        }
        let mut new_strings = Vec::new();
        let mut n_strings = 0u64;
        let strings = &mut self.strings;
        let mut sid = |bytes: &[u8]| -> u32 {
            if let Some(&id) = strings.get(bytes) {
                return id;
            }
            let id = strings.len() as u32;
            strings.insert(Box::from(bytes), id);
            put_varint(&mut new_strings, bytes.len() as u64);
            new_strings.extend_from_slice(bytes);
            n_strings += 1;
            id
        };
        let mut new_entries = Vec::new();
        let mut n_entries = 0u64;
        let mut lists: [Vec<u32>; 4] = Default::default();
        let mut encoded = Vec::with_capacity(128);
        for entry in state.entries {
            encoded.clear();
            encoded.push(entry.kind());
            match entry {
                Entry::Resolution {
                    flags,
                    kind,
                    specifier,
                    importer,
                    paths,
                    check,
                } => {
                    let flags = flags | if check.is_some() { HAS_CHECK } else { 0 };
                    put_varint(&mut encoded, u64::from(flags));
                    for part in [kind, specifier, importer] {
                        put_varint(&mut encoded, u64::from(sid(&part[..])));
                    }
                    put_varint(&mut encoded, paths.len() as u64);
                    for (path, from_root) in paths {
                        put_varint(&mut encoded, u64::from(sid(&path[..])));
                        encoded.push(*from_root as u8);
                    }
                    if let Some(check) = check {
                        encoded.extend_from_slice(check);
                    }
                }
                Entry::Module {
                    flags,
                    path,
                    sha256,
                    aot,
                } => {
                    let flags = flags
                        | if sha256.is_some() { HAS_SHA } else { 0 }
                        | if aot.is_some() { HAS_AOT } else { 0 };
                    put_varint(&mut encoded, u64::from(flags));
                    put_varint(&mut encoded, u64::from(sid(&path[..])));
                    for hash in [sha256, aot].into_iter().flatten() {
                        encoded.extend_from_slice(hash);
                    }
                }
                Entry::Answer { path, sha256 } => {
                    put_varint(
                        &mut encoded,
                        u64::from(if sha256.is_some() { HAS_SHA } else { 0 }),
                    );
                    put_varint(&mut encoded, u64::from(sid(&path[..])));
                    if let Some(sha256) = sha256 {
                        encoded.extend_from_slice(sha256);
                    }
                }
                Entry::Read {
                    look,
                    path,
                    extra,
                    value,
                } => {
                    for part in [look.as_bytes(), &path[..], &extra[..], &value[..]] {
                        put_varint(&mut encoded, u64::from(sid(part)));
                    }
                }
            }
            let id = match self.entries.get(&encoded[..]) {
                Some(&id) => id,
                None => {
                    let id = self.entries.len() as u32;
                    self.entries.insert(Box::from(&encoded[..]), id);
                    new_entries.extend_from_slice(&encoded);
                    n_entries += 1;
                    id
                }
            };
            lists[usize::from(entry.kind())].push(id);
        }
        let stored = State {
            file: sid(state.file),
            fingerprint: state.fingerprint,
            time: now_ns(),
            header: Header {
                outcome: state.header.outcome,
                unattributed_before: state.header.unattributed_before,
                late_from_earlier_files: state.header.late_from_earlier_files,
                marks: state.header.marks.iter().map(|it| sid(&it[..])).collect(),
            },
            lists,
        };
        let mut payload = Vec::with_capacity(new_strings.len() + new_entries.len() + 1024);
        put_varint(&mut payload, n_strings);
        payload.extend_from_slice(&new_strings);
        put_varint(&mut payload, n_entries);
        payload.extend_from_slice(&new_entries);
        put_varint(&mut payload, 1);
        put_state(&mut payload, &stored);
        let mut chunk = Vec::with_capacity(payload.len() + 8);
        put_chunk(&mut chunk, &payload);
        let written = self.file.write_all(&chunk);
        self.broken = written.is_err();
        written
    }
}

// ── Reading ──

impl Store {
    fn intern_string(&mut self, bytes: &[u8]) -> u32 {
        if let Some(&id) = self.string_ids.get(bytes) {
            return id;
        }
        let id = self.strings.len() as u32;
        self.strings.push(Box::from(bytes));
        self.string_ids.insert(Box::from(bytes), id);
        id
    }

    fn intern_entry(&mut self, encoded: &[u8]) -> u32 {
        if let Some(&id) = self.entry_ids.get(encoded) {
            return id;
        }
        let id = self.entries.len() as u32;
        self.entries.push(Box::from(encoded));
        self.entry_ids.insert(Box::from(encoded), id);
        id
    }

    /// Adds what a store or segment file holds. `false` when it is of another version.
    fn add_file(&mut self, bytes: &[u8]) -> bool {
        let mut input = bytes;
        let Some(header) = take(&mut input, 8) else {
            // An empty segment: its writer had not written its header yet.
            return true;
        };
        if &header[..4] != MAGIC || header[4..] != STORE_VERSION.to_le_bytes() {
            self.other_format += 1;
            return false;
        }
        self.bytes += bytes.len() as u64;
        let mut local_strings: Vec<u32> = Vec::new();
        let mut local_entries: Vec<u32> = Vec::new();
        while let Some(chunk) = Self::next_chunk(&mut input) {
            if self
                .add_chunk(chunk, &mut local_strings, &mut local_entries)
                .is_none()
            {
                break;
            }
        }
        true
    }

    fn next_chunk<'a>(input: &mut &'a [u8]) -> Option<&'a [u8]> {
        let len = u32::from_le_bytes(take(input, 4)?.try_into().ok()?) as usize;
        let sum = u32::from_le_bytes(take(input, 4)?.try_into().ok()?);
        let payload = take(input, len)?;
        (bun_wyhash::hash32(payload) == sum).then_some(payload)
    }

    fn add_chunk(
        &mut self,
        mut input: &[u8],
        local_strings: &mut Vec<u32>,
        local_entries: &mut Vec<u32>,
    ) -> Option<()> {
        let input = &mut input;
        for _ in 0..varint(input)? {
            let len = varint(input)? as usize;
            let bytes = take(input, len)?;
            let id = self.intern_string(bytes);
            local_strings.push(id);
        }
        let mut encoded = Vec::with_capacity(128);
        for _ in 0..varint(input)? {
            encoded.clear();
            remap_entry(input, &mut encoded, &mut |it| {
                local_strings.get(it as usize).copied()
            })?;
            let id = self.intern_entry(&encoded);
            local_entries.push(id);
        }
        for _ in 0..varint(input)? {
            let state = get_state(
                input,
                &mut |it| local_strings.get(it as usize).copied(),
                &mut |it| local_entries.get(it as usize).copied(),
            )?;
            self.states.push(state);
        }
        Some(())
    }

    fn read_into(&mut self, path: &bun_core::ZStr) -> Option<bool> {
        let file = bun_sys::File::open(path, O::RDONLY | O::CLOEXEC, 0).ok()?;
        Some(self.add_file(&file.read_to_end().ok()?))
    }

    /// The store and every segment of `dir`, as one moment of them.
    pub fn load(dir: &[u8]) -> Store {
        let mut store = Store::default();
        let Some(lock_file) = open_lock(dir) else {
            return store;
        };
        lock(&lock_file, FileLockMode::Shared, false);
        store.read_into(&Path::from_parts(&[dir, STORE_FILE.as_bytes()]));
        for path in segment_paths(dir) {
            if store.read_into(&path).is_some() {
                store.segments += 1;
            }
        }
        store
    }

    pub fn string(&self, id: u32) -> &[u8] {
        self.strings.get(id as usize).map_or(b"", |it| &**it)
    }

    pub fn entry(&self, entry_id: u32) -> Option<EntryView<'_>> {
        let mut input: &[u8] = self.entries.get(entry_id as usize)?;
        let input = &mut input;
        let (&kind, rest) = input.split_first()?;
        *input = rest;
        let strings = &self.strings[..];
        let s = |input: &mut &[u8]| string_at(strings, input);
        Some(match kind {
            RESOLUTION => {
                let flags = id(input)?;
                let kind = s(input)?;
                let specifier = s(input)?;
                let importer = s(input)?;
                let n = id(input)?;
                let mut paths = Vec::with_capacity(n as usize);
                for _ in 0..n {
                    let path = s(input)?;
                    paths.push((path, take(input, 1)?[0] != 0));
                }
                let check = if flags & HAS_CHECK != 0 {
                    Some(hash32(input)?)
                } else {
                    None
                };
                EntryView::Resolution {
                    flags,
                    kind,
                    specifier,
                    importer,
                    paths,
                    check,
                }
            }
            MODULE | ANSWER => {
                let flags = id(input)?;
                let path = s(input)?;
                let sha256 = if flags & HAS_SHA != 0 {
                    Some(hash32(input)?)
                } else {
                    None
                };
                if kind == ANSWER {
                    EntryView::Answer { path, sha256 }
                } else {
                    let aot = if flags & HAS_AOT != 0 {
                        Some(hash32(input)?)
                    } else {
                        None
                    };
                    EntryView::Module {
                        flags,
                        path,
                        sha256,
                        aot,
                    }
                }
            }
            READ => EntryView::Read {
                look: s(input)?,
                path: s(input)?,
                extra: s(input)?,
                value: s(input)?,
            },
            _ => return None,
        })
    }

    /// State indexes by the test file's path as records write it, newest first.
    pub fn by_file(&self) -> HashMap<&[u8], Vec<usize>> {
        let mut out: HashMap<&[u8], Vec<usize>> = HashMap::new();
        for (i, state) in self.states.iter().enumerate() {
            out.entry(self.string(state.file)).or_default().push(i);
        }
        for list in out.values_mut() {
            list.sort_by_key(|&i| core::cmp::Reverse(self.states[i].time));
        }
        out
    }

    /// The bytes of the merged store: the newest distinct states of each file, and only the strings
    /// and entries they use.
    fn merged(&self) -> (Vec<u8>, usize) {
        let mut kept: Vec<&State> = Vec::new();
        for list in self.by_file().values() {
            let mut seen: Vec<&State> = Vec::new();
            for &i in list {
                let state = &self.states[i];
                if seen
                    .iter()
                    .any(|it| it.fingerprint == state.fingerprint && it.lists == state.lists)
                {
                    continue;
                }
                seen.push(state);
                if seen.len() == STATES_PER_FILE {
                    break;
                }
            }
            kept.extend(seen);
        }
        kept.sort_by_key(|it| (it.file, it.time));
        let mut string_map: Vec<u32> = vec![u32::MAX; self.strings.len()];
        let mut entry_map: Vec<u32> = vec![u32::MAX; self.entries.len()];
        let mut strings = Vec::new();
        let mut n_strings = 0u64;
        let mut entries = Vec::new();
        let mut n_entries = 0u64;
        let mut states = Vec::new();
        let mut new_string = |old: u32, strings: &mut Vec<u8>| -> Option<u32> {
            let slot = string_map.get_mut(old as usize)?;
            if *slot == u32::MAX {
                *slot = n_strings as u32;
                n_strings += 1;
                let bytes = &self.strings[old as usize];
                put_varint(strings, bytes.len() as u64);
                strings.extend_from_slice(bytes);
            }
            Some(*slot)
        };
        for state in &kept {
            let mut lists: [Vec<u32>; 4] = Default::default();
            for (list, old) in lists.iter_mut().zip(&state.lists) {
                for &entry in old {
                    let slot = &mut entry_map[entry as usize];
                    if *slot == u32::MAX {
                        *slot = n_entries as u32;
                        n_entries += 1;
                        let mut input: &[u8] = &self.entries[entry as usize];
                        let _ = remap_entry(&mut input, &mut entries, &mut |it| {
                            new_string(it, &mut strings)
                        });
                    }
                    list.push(*slot);
                }
            }
            let state = State {
                file: new_string(state.file, &mut strings).unwrap_or(0),
                header: Header {
                    marks: (state.header.marks.iter())
                        .filter_map(|&it| new_string(it, &mut strings))
                        .collect(),
                    ..state.header.clone()
                },
                lists,
                ..(*state).clone()
            };
            put_state(&mut states, &state);
        }
        let mut payload = Vec::with_capacity(strings.len() + entries.len() + states.len() + 32);
        put_varint(&mut payload, n_strings);
        payload.extend_from_slice(&strings);
        put_varint(&mut payload, n_entries);
        payload.extend_from_slice(&entries);
        put_varint(&mut payload, kept.len() as u64);
        payload.extend_from_slice(&states);
        let mut out = Vec::with_capacity(payload.len() + 16);
        file_header(&mut out);
        put_chunk(&mut out, &payload);
        (out, kept.len())
    }
}

fn string_at<'a>(strings: &'a [Box<[u8]>], input: &mut &[u8]) -> Option<&'a [u8]> {
    Some(&**strings.get(id(input)? as usize)?)
}

fn segment_paths(dir: &[u8]) -> Vec<Path> {
    let segments = Path::from_parts(&[dir, SEGMENTS.as_bytes()]);
    let Ok(folder) = bun_sys::Dir::open(&segments) else {
        return Vec::new();
    };
    let mut entries = bun_sys::dir_iterator::iterate(folder.fd());
    let mut out = Vec::new();
    while let Ok(Some(entry)) = entries.next() {
        let name = entry.name.slice_u8();
        if name.ends_with(b".seg") {
            out.push(Path::from_parts(&[&segments, name]));
        }
    }
    out.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
    out
}

/// What [`merge`] did.
pub struct Merged {
    pub segments: usize,
    pub states: usize,
    pub bytes: usize,
}

/// Merges the segments whose writers have exited into the store of `dir`. Segments of processes
/// still running stay as they are; a later merge takes them.
pub fn merge(dir: &[u8]) -> bun_sys::Result<Option<Merged>> {
    if segment_paths(dir).is_empty() {
        return Ok(None);
    }
    let Some(lock_file) = open_lock(dir) else {
        return Ok(None);
    };
    lock(&lock_file, FileLockMode::Exclusive, false);
    let mut store = Store::default();
    let dest = Path::from_parts(&[dir, STORE_FILE.as_bytes()]);
    store.read_into(&dest);
    let mut taken = Vec::new();
    for path in segment_paths(dir) {
        let Ok(file) = bun_sys::File::open(&path, O::RDONLY | O::CLOEXEC, 0) else {
            continue;
        };
        if !lock(&file, FileLockMode::Exclusive, true) {
            continue;
        }
        if let Ok(bytes) = file.read_to_end() {
            store.add_file(&bytes);
        }
        taken.push((path, file));
    }
    if taken.is_empty() {
        return Ok(None);
    }
    let (bytes, states) = store.merged();
    let tmp = Path::from_parts(&[
        dir,
        format!("{STORE_FILE}.{}.tmp", std::process::id()).as_bytes(),
    ]);
    let tmp = bun_sys::UnlinkOnDrop::new(bun_sys::Fd::cwd(), tmp);
    let flags = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC;
    bun_sys::File::open(&tmp, flags, 0o666)
        .and_then(|file| file.write_all(&bytes))
        .and_then(|()| tmp.rename_to(bun_sys::Fd::cwd(), &dest))?;
    for (path, _) in &taken {
        let _ = bun_sys::unlink(path);
    }
    Ok(Some(Merged {
        segments: taken.len(),
        states,
        bytes: bytes.len(),
    }))
}
