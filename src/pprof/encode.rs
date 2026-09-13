//! A heap-profile session as a pprof `Profile` message.
//! <https://github.com/google/pprof/blob/main/proto/profile.proto>

use bun_collections::HashMap;

use bun_sys::loaded_modules::{self, LoadedModule};

use crate::heap::{Bucket, JS_TAG, JsLocation, Session, Span};
use crate::proto::Writer;

/// What `encode` reads of a session.
pub(crate) struct View<'a> {
    sample_interval: usize,
    started_at_ns: i64,
    samples: u64,
    dropped: u64,
    buckets: &'a [Bucket],
    stacks: &'a [usize],
    js_locations: &'a [JsLocation],
    string_bytes: &'a [u8],
    string_spans: &'a [Span],
}

impl<'a> View<'a> {
    pub(crate) fn of(session: &'a Session) -> Self {
        Self {
            sample_interval: session.sample_interval,
            started_at_ns: session.started_at_ns,
            samples: session.samples,
            dropped: session.dropped,
            buckets: &session.buckets,
            stacks: &session.stacks,
            js_locations: &session.js_locations,
            string_bytes: &session.strings.bytes,
            string_spans: &session.strings.spans,
        }
    }

    fn string(&self, id: u32) -> &'a [u8] {
        match self.string_spans.get(id as usize) {
            Some(span) => &self.string_bytes[span.start as usize..][..span.len as usize],
            None => b"",
        }
    }
}

/// A copy of a running session: allocated without the session lock, filled under it.
pub(crate) struct Snapshot {
    sizes: [usize; 5],
    sample_interval: usize,
    started_at_ns: i64,
    samples: u64,
    dropped: u64,
    buckets: Vec<Bucket>,
    stacks: Vec<usize>,
    js_locations: Vec<JsLocation>,
    string_bytes: Vec<u8>,
    string_spans: Vec<Span>,
}

impl Snapshot {
    pub(crate) fn sized_for(session: &Session) -> Self {
        Self {
            sizes: [
                session.buckets.len(),
                session.stacks.len(),
                session.js_locations.len(),
                session.strings.bytes.len(),
                session.strings.spans.len(),
            ],
            sample_interval: 0,
            started_at_ns: 0,
            samples: 0,
            dropped: 0,
            buckets: Vec::new(),
            stacks: Vec::new(),
            js_locations: Vec::new(),
            string_bytes: Vec::new(),
            string_spans: Vec::new(),
        }
    }

    pub(crate) fn reserve(&mut self) {
        let with_slack = |n: usize| n + n / 8 + 64;
        self.buckets.reserve_exact(with_slack(self.sizes[0]));
        self.stacks.reserve_exact(with_slack(self.sizes[1]));
        self.js_locations.reserve_exact(with_slack(self.sizes[2]));
        self.string_bytes.reserve_exact(with_slack(self.sizes[3]));
        self.string_spans.reserve_exact(with_slack(self.sizes[4]));
    }

    /// `false` when the session outgrew `reserve`: size and try again.
    pub(crate) fn fill_from(&mut self, session: &Session) -> bool {
        if session.buckets.len() > self.buckets.capacity()
            || session.stacks.len() > self.stacks.capacity()
            || session.js_locations.len() > self.js_locations.capacity()
            || session.strings.bytes.len() > self.string_bytes.capacity()
            || session.strings.spans.len() > self.string_spans.capacity()
        {
            return false;
        }
        self.sample_interval = session.sample_interval;
        self.started_at_ns = session.started_at_ns;
        self.samples = session.samples;
        self.dropped = session.dropped;
        self.buckets.extend_from_slice(&session.buckets);
        self.stacks.extend_from_slice(&session.stacks);
        self.js_locations.extend_from_slice(&session.js_locations);
        self.string_bytes.extend_from_slice(&session.strings.bytes);
        self.string_spans.extend_from_slice(&session.strings.spans);
        true
    }

    pub(crate) fn view(&self) -> View<'_> {
        View {
            sample_interval: self.sample_interval,
            started_at_ns: self.started_at_ns,
            samples: self.samples,
            dropped: self.dropped,
            buckets: &self.buckets,
            stacks: &self.stacks,
            js_locations: &self.js_locations,
            string_bytes: &self.string_bytes,
            string_spans: &self.string_spans,
        }
    }
}

/// `Profile.string_table`. Index 0 is "".
struct StringTable<'a> {
    list: Vec<&'a [u8]>,
    index: HashMap<&'a [u8], u64>,
}

impl<'a> StringTable<'a> {
    fn new() -> Self {
        let mut table = Self {
            list: Vec::new(),
            index: HashMap::default(),
        };
        table.id(b"");
        table
    }

    fn id(&mut self, value: &'a [u8]) -> u64 {
        *self.index.entry(value).or_insert_with(|| {
            self.list.push(value);
            self.list.len() as u64 - 1
        })
    }
}

// Field numbers of profile.proto.
mod field {
    pub(super) mod profile {
        pub(crate) const SAMPLE_TYPE: u32 = 1;
        pub(crate) const SAMPLE: u32 = 2;
        pub(crate) const MAPPING: u32 = 3;
        pub(crate) const LOCATION: u32 = 4;
        pub(crate) const FUNCTION: u32 = 5;
        pub(crate) const STRING_TABLE: u32 = 6;
        pub(crate) const DROP_FRAMES: u32 = 7;
        pub(crate) const TIME_NANOS: u32 = 9;
        pub(crate) const DURATION_NANOS: u32 = 10;
        pub(crate) const PERIOD_TYPE: u32 = 11;
        pub(crate) const PERIOD: u32 = 12;
        pub(crate) const COMMENT: u32 = 13;
        pub(crate) const DEFAULT_SAMPLE_TYPE: u32 = 14;
    }
    pub(super) mod value_type {
        pub(crate) const TYPE: u32 = 1;
        pub(crate) const UNIT: u32 = 2;
    }
    pub(super) mod sample {
        pub(crate) const LOCATION_ID: u32 = 1;
        pub(crate) const VALUE: u32 = 2;
        pub(crate) const LABEL: u32 = 3;
    }
    pub(super) mod label {
        pub(crate) const KEY: u32 = 1;
        pub(crate) const STR: u32 = 2;
        pub(crate) const NUM: u32 = 3;
    }
    pub(super) mod mapping {
        pub(crate) const ID: u32 = 1;
        pub(crate) const MEMORY_START: u32 = 2;
        pub(crate) const MEMORY_LIMIT: u32 = 3;
        pub(crate) const FILE_OFFSET: u32 = 4;
        pub(crate) const FILENAME: u32 = 5;
        pub(crate) const BUILD_ID: u32 = 6;
    }
    pub(super) mod location {
        pub(crate) const ID: u32 = 1;
        pub(crate) const MAPPING_ID: u32 = 2;
        pub(crate) const ADDRESS: u32 = 3;
        pub(crate) const LINE: u32 = 4;
    }
    pub(super) mod line {
        pub(crate) const FUNCTION_ID: u32 = 1;
        pub(crate) const LINE: u32 = 2;
        pub(crate) const COLUMN: u32 = 3;
    }
    pub(super) mod function {
        pub(crate) const ID: u32 = 1;
        pub(crate) const NAME: u32 = 2;
        pub(crate) const SYSTEM_NAME: u32 = 3;
        pub(crate) const FILENAME: u32 = 4;
        pub(crate) const START_LINE: u32 = 5;
    }
}

enum Location {
    Native {
        address: usize,
        mapping: u64,
    },
    Js {
        function: u64,
        line: u32,
        column: u32,
    },
}

fn module_containing(modules: &[LoadedModule], address: usize) -> Option<usize> {
    let after = modules.partition_point(|m| m.start <= address);
    (after > 0 && address < modules[after - 1].limit).then_some(after - 1)
}

/// The uncompressed `Profile`, numbered in first-seen order.
pub(crate) fn encode(view: &View<'_>) -> Vec<u8> {
    use field::profile;

    // A return address symbolizes to the line after the call; one byte back is in the call.
    let address_of = |word: usize| word.wrapping_sub(1);

    let mut addresses: Vec<usize> = view
        .stacks
        .iter()
        .filter(|&&word| word & JS_TAG == 0)
        .map(|&word| address_of(word))
        .collect();
    addresses.sort_unstable();
    addresses.dedup();
    let modules = loaded_modules::modules_containing(&addresses);
    let build_ids: Vec<Vec<u8>> = modules
        .iter()
        .map(|m| bun_core::fmt::bytes_to_hex_lower_string(&m.build_id).into_bytes())
        .collect();

    let mut strings = StringTable::new();
    let mut w = Writer::new();

    for (kind, unit) in [
        (&b"alloc_objects"[..], &b"count"[..]),
        (b"alloc_space", b"bytes"),
        (b"inuse_objects", b"count"),
        (b"inuse_space", b"bytes"),
    ] {
        let (kind, unit) = (strings.id(kind), strings.id(unit));
        w.message(profile::SAMPLE_TYPE, |m| {
            m.uint64(field::value_type::TYPE, kind);
            m.uint64(field::value_type::UNIT, unit);
        });
    }

    let thread_key = strings.id(b"thread");
    let worker_key = strings.id(b"worker");
    let generated_key = strings.id(b"generated");
    let true_value = strings.id(b"true");

    let mut locations: Vec<Location> = Vec::new();
    let mut location_ids: HashMap<usize, u64> = HashMap::default();
    let mut functions: Vec<(u64, u64, u32)> = Vec::new();
    let mut function_ids: HashMap<(u64, u64, u32), u64> = HashMap::default();
    let mut ids: Vec<u64> = Vec::new();

    for b in view.buckets {
        ids.clear();
        let stack = &view.stacks[b.stack_start as usize..][..b.depth as usize];
        let js_location = |word: usize| {
            (word & JS_TAG != 0)
                .then(|| view.js_locations.get(word & !JS_TAG))
                .flatten()
        };
        let generated = stack
            .iter()
            .any(|&word| js_location(word).is_some_and(|l| !l.is_resolved()));
        for &word in stack {
            if let Some(&id) = location_ids.get(&word) {
                if id != 0 {
                    ids.push(id);
                }
                continue;
            }
            let location = if word & JS_TAG != 0 {
                js_location(word).map(|l| {
                    let at = l.position();
                    let key = (
                        strings.id(view.string(l.name)),
                        strings.id(view.string(at.url)),
                        at.function_line,
                    );
                    let function = *function_ids.entry(key).or_insert_with(|| {
                        functions.push(key);
                        functions.len() as u64
                    });
                    Location::Js {
                        function,
                        line: at.line,
                        column: at.column,
                    }
                })
            } else {
                let address = address_of(word);
                // No mapping: JIT code, which the JavaScript frames stand for.
                module_containing(&modules, address).map(|m| Location::Native {
                    address,
                    mapping: m as u64 + 1,
                })
            };
            let id = match location {
                Some(location) => {
                    locations.push(location);
                    locations.len() as u64
                }
                None => 0,
            };
            location_ids.insert(word, id);
            if id != 0 {
                ids.push(id);
            }
        }
        let values = [
            b.alloc_objects,
            b.alloc_bytes,
            b.alloc_objects.saturating_sub(b.free_objects),
            b.alloc_bytes.saturating_sub(b.free_bytes),
        ];
        let thread = strings.id(view.string(b.thread));
        w.message(profile::SAMPLE, |m| {
            m.packed(field::sample::LOCATION_ID, &ids);
            m.packed(field::sample::VALUE, &values);
            if thread != 0 {
                m.message(field::sample::LABEL, |l| {
                    l.uint64(field::label::KEY, thread_key);
                    l.uint64(field::label::STR, thread);
                });
            }
            if b.worker != 0 {
                m.message(field::sample::LABEL, |l| {
                    l.uint64(field::label::KEY, worker_key);
                    l.uint64(field::label::NUM, u64::from(b.worker));
                });
            }
            // Only a VM's own thread can use its sourcemaps: these are positions in the code that ran.
            if generated {
                m.message(field::sample::LABEL, |l| {
                    l.uint64(field::label::KEY, generated_key);
                    l.uint64(field::label::STR, true_value);
                });
            }
        });
    }

    for (i, (module, build_id)) in modules.iter().zip(&build_ids).enumerate() {
        let (path, build_id) = (strings.id(&module.path), strings.id(build_id));
        w.message(profile::MAPPING, |m| {
            m.uint64(field::mapping::ID, i as u64 + 1);
            m.uint64(field::mapping::MEMORY_START, module.start as u64);
            m.uint64(field::mapping::MEMORY_LIMIT, module.limit as u64);
            m.uint64(field::mapping::FILE_OFFSET, module.file_offset);
            m.uint64(field::mapping::FILENAME, path);
            m.uint64(field::mapping::BUILD_ID, build_id);
        });
    }

    for (i, location) in locations.iter().enumerate() {
        w.message(profile::LOCATION, |m| {
            m.uint64(field::location::ID, i as u64 + 1);
            match *location {
                Location::Native { address, mapping } => {
                    m.uint64(field::location::MAPPING_ID, mapping);
                    m.uint64(field::location::ADDRESS, address as u64);
                }
                Location::Js {
                    function,
                    line,
                    column,
                } => m.message(field::location::LINE, |l| {
                    l.uint64(field::line::FUNCTION_ID, function);
                    l.uint64(field::line::LINE, u64::from(line));
                    l.uint64(field::line::COLUMN, u64::from(column));
                }),
            }
        });
    }

    for (i, &(name, file, start_line)) in functions.iter().enumerate() {
        w.message(profile::FUNCTION, |m| {
            m.uint64(field::function::ID, i as u64 + 1);
            m.uint64(field::function::NAME, name);
            m.uint64(field::function::SYSTEM_NAME, name);
            m.uint64(field::function::FILENAME, file);
            m.uint64(field::function::START_LINE, u64::from(start_line));
        });
    }

    let drop_frames = strings.id(b"_?mi_[a-z0-9_]+");
    let (space, bytes) = (strings.id(b"space"), strings.id(b"bytes"));
    let default_type = strings.id(b"inuse_space");
    let comment = format!(
        "bun {}: {} samples, {} not recorded",
        bun_core::Global::package_json_version,
        view.samples,
        view.dropped
    );
    let comment = strings.id(comment.as_bytes());

    for s in &strings.list {
        w.bytes(profile::STRING_TABLE, s);
    }
    w.uint64(profile::DROP_FRAMES, drop_frames);
    w.int64(profile::TIME_NANOS, view.started_at_ns);
    w.int64(
        profile::DURATION_NANOS,
        crate::heap::now_ns().saturating_sub(view.started_at_ns),
    );
    w.message(profile::PERIOD_TYPE, |m| {
        m.uint64(field::value_type::TYPE, space);
        m.uint64(field::value_type::UNIT, bytes);
    });
    w.int64(profile::PERIOD, view.sample_interval as i64);
    w.packed(profile::COMMENT, &[comment]);
    w.uint64(profile::DEFAULT_SAMPLE_TYPE, default_type);
    w.buf
}

pub(crate) fn gzip(profile: &[u8]) -> Option<Vec<u8>> {
    use bun_libdeflate_sys::libdeflate::{Encoding, OwnedCompressor};
    let mut out = Vec::new();
    OwnedCompressor::new(6)?
        .compress_to_vec(profile, &mut out, Encoding::Gzip)
        .ok()?;
    Some(out)
}
