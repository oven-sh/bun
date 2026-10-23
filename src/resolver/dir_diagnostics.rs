//! What the resolver reported when it read a directory's package.json and tsconfig.json into
//! `DirInfo`.
//!
//! `DirInfo` is one cache for the process. The resolver that reads a directory first has the
//! messages in its log, and each later one finds the directory in the cache. A build reports what
//! is wrong with the files it depends on whether or not it is the first to read them, so the
//! messages stay here, one record for each directory, and each build takes them once
//! (`Resolver::report_dir_diagnostics`).
//!
//! `DirInfo::diagnostics` names the record of the directory, or of the nearest one above it that
//! has one. The key of such a directory is tagged in the `DirInfo` index, which sends its lookups
//! to `Resolver::dir_info_cached_miss`. A directory with nothing reported above it costs nothing.

use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_ast::Msg;
use bun_collections::StringHashMap;
use bun_paths::string_paths::without_trailing_slash_windows_path;

/// `DirInfo::diagnostics`. 0: none.
pub(crate) type Id = u16;

/// The bytes that a file had when the resolver read it.
#[derive(PartialEq, Eq)]
pub(crate) struct Stamp {
    pub(crate) path: Box<[u8]>,
    /// Length and hash. `None`: the file could not be read.
    contents: Option<(usize, u64)>,
}

impl Stamp {
    pub(crate) fn new(path: &[u8], contents: Option<&[u8]>) -> Stamp {
        Stamp {
            path: Box::from(path),
            contents: contents.map(Self::of),
        }
    }

    pub(crate) fn is_of(&self, contents: Option<&[u8]>) -> bool {
        self.contents == contents.map(Self::of)
    }

    fn of(contents: &[u8]) -> (usize, u64) {
        (contents.len(), bun_wyhash::hash(contents))
    }
}

/// The warnings and errors of one read of a package.json, or of a tsconfig.json and what it
/// extends, with the files that had them.
#[derive(Default)]
pub(crate) struct Reported {
    pub(crate) msgs: Vec<Msg>,
    pub(crate) read: Vec<Stamp>,
}

/// The sessions that a record remembers. More than this many builds that run at once and use one
/// directory report it more than once.
const TAKERS: usize = 4;

#[derive(Default)]
pub(crate) struct Record {
    pub(crate) dir: Box<[u8]>,
    /// The record of the nearest directory above that has one.
    pub(crate) above: Id,
    pub(crate) package_json: Reported,
    pub(crate) tsconfig: Reported,
    taken_by: [u64; TAKERS],
    next_taker: usize,
    /// The session that read the files. For it they are what `read` says.
    read_by: u64,
}

impl Record {
    pub(crate) fn is_taken_by(&self, session: u64) -> bool {
        self.taken_by.contains(&session)
    }

    pub(crate) fn set_taken_by(&mut self, session: u64) {
        self.taken_by[self.next_taker % TAKERS] = session;
        self.next_taker += 1;
    }

    pub(crate) fn is_read_by(&self, session: u64) -> bool {
        self.read_by == session
    }
}

#[derive(Default)]
pub(crate) struct Registry {
    records: Vec<Record>,
    by_dir: StringHashMap<Id>,
}

/// What `Registry::update` did.
pub(crate) struct Updated {
    /// The record of the directory, which can have no messages.
    pub(crate) id: Id,
    /// It had a record, from files with other bytes.
    pub(crate) changed: bool,
}

impl Registry {
    pub(crate) fn record(&mut self, id: Id) -> &mut Record {
        &mut self.records[usize::from(id) - 1]
    }

    /// Is `id` the record `from`, or above it?
    pub(crate) fn reaches(&self, mut from: Id, id: Id) -> bool {
        while from != 0 {
            if from == id {
                return true;
            }
            from = self.records[usize::from(from) - 1].above;
        }
        false
    }

    /// Takes what a read of the directory `dir` reported, in place of what the read before it
    /// reported. `None`: the directory has no record, and needs none or cannot have one.
    pub(crate) fn update(
        &mut self,
        dir: &[u8],
        above: Id,
        package_json: &mut Reported,
        tsconfig: &mut Reported,
        session: u64,
    ) -> Option<Updated> {
        let dir = without_trailing_slash_windows_path(dir);
        let (id, is_new) = match self.by_dir.get(dir) {
            Some(&id) => (id, false),
            None => {
                if package_json.msgs.is_empty() && tsconfig.msgs.is_empty() {
                    return None;
                }
                let id = Id::try_from(self.records.len() + 1).ok()?;
                self.by_dir.put(dir, id).ok()?;
                self.records.push(Record {
                    dir: Box::from(dir),
                    ..Default::default()
                });
                ANY.store(true, Ordering::Release);
                (id, true)
            }
        };
        let record = self.record(id);
        let changed = !is_new
            && (record.package_json.read != package_json.read
                || record.tsconfig.read != tsconfig.read);
        if changed {
            record.taken_by = [0; TAKERS];
        }
        record.above = above;
        record.package_json = core::mem::take(package_json);
        record.tsconfig = core::mem::take(tsconfig);
        record.read_by = session;
        Some(Updated { id, changed })
    }
}

static ANY: AtomicBool = AtomicBool::new(false);

/// Is there a record? Until there is one, a read of a directory that reports nothing has nothing
/// to look up.
#[inline]
pub(crate) fn any() -> bool {
    ANY.load(Ordering::Acquire)
}

pub(crate) fn lock() -> bun_threading::guarded::GuardedLock<'static, Registry, bun_threading::Mutex>
{
    static REGISTRY: std::sync::LazyLock<bun_threading::Guarded<Registry>> =
        std::sync::LazyLock::new(Default::default);
    REGISTRY.lock()
}

/// A session is one build: the resolvers that write to its log. Each takes a record once.
pub(crate) fn next_session() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}
