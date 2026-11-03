//! What an asker of the directory caches trusts, and what a lookup does after a miss.

#![allow(clippy::disallowed_methods)]

use super::*;
use ::bun_core::next_generation;
use core::sync::atomic::Ordering;
use std::os::unix::ffi::OsStrExt as _;
use std::time::{Duration, Instant};

/// `bun_install` defines it for Bun. No `package.json` of these tests has dependencies.
#[unsafe(no_mangle)]
fn __bun_resolver_parse_dependency(
    _name: Semver::String,
    _name_hash: Install::PackageNameHash,
    _version: &[u8],
    _sliced: &Semver::SlicedString,
    _log: Option<&mut bun_ast::Log>,
) -> Option<Dependency::Version> {
    None
}

/// `bun_install` defines it for Bun. Here no package manager comes: each call is counted, and fails.
#[unsafe(no_mangle)]
fn __bun_resolver_init_package_manager(
    _log: NonNull<bun_ast::Log>,
    _install: Option<NonNull<bun_options_types::schema::api::BunInstall>>,
    _env: NonNull<bun_dotenv::Loader>,
    _prefer_offline: bool,
    _importer_dir: &[u8],
) -> crate::CrateResult<NonNull<dyn AutoInstaller>> {
    PACKAGE_MANAGER_ASKED.fetch_add(1, Ordering::Relaxed);
    Err(crate::Error::ModuleNotFound)
}

/// How many times a lookup asked for the package manager.
static PACKAGE_MANAGER_ASKED: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(0);

/// How many times the names of a listing were read again in place.
fn version_of(entries: &Fs::file_system::DirEntry) -> u64 {
    u64::from(entries.version)
}

/// The generation that a slot was filled at, or last checked at.
fn stamp_of(info: DirInfoRef) -> Generation {
    info.stamp.load(Ordering::Relaxed)
}

fn is_link(entry: &Fs::file_system::Entry) -> bool {
    entry.is_link.load(Ordering::Relaxed)
}

/// Lookups run again, new listings and refills of the process so far.
fn counters() -> (usize, usize, usize) {
    let now = test_hooks::counters();
    (now.lookups_run_again, now.new_listings, now.refills)
}

fn options() -> options::BundleOptions {
    let group = || options::ExtensionOrderGroup {
        default: Box::default(),
        esm: Box::default(),
    };
    options::BundleOptions {
        target: options::Target::Bun,
        packages: Default::default(),
        jsx: Default::default(),
        extension_order: options::ExtensionOrder {
            default: group(),
            node_modules: group(),
            required_by_package: Box::default(),
            css: Box::default(),
        },
        conditions: Default::default(),
        external: Default::default(),
        extra_cjs_extensions: Box::default(),
        framework: None,
        global_cache: Default::default(),
        install: None,
        load_package_json: true,
        load_tsconfig_json: true,
        main_field_extension_order: Box::default(),
        main_fields: Box::default(),
        main_fields_is_default: true,
        mark_builtins_as_external: false,
        polyfill_node_globals: false,
        install_preference: Default::default(),
        preserve_symlinks: false,
        rewrite_jest_for_tests: false,
        tsconfig_override: None,
        tsconfig_override_json: None,
        production: false,
        force_node_env: Default::default(),
        output_dir: Box::default(),
        root_dir: Box::default(),
        public_path: Box::default(),
        compile: false,
        supports_multiple_outputs: false,
        tree_shaking: false,
        allow_runtime: false,
    }
}

/// The caches and their counters belong to the process: the tests that have a resolver run one at a time.
static ONE_AT_A_TIME: Mutex = Mutex::new();

thread_local! {
    /// Held from the first resolver of a test until the thread of that test ends.
    static TURN: core::cell::RefCell<Option<bun_threading::MutexGuard>> =
        const { core::cell::RefCell::new(None) };
}

fn resolver() -> Resolver<'static> {
    TURN.with_borrow_mut(|turn| {
        if turn.is_none() {
            *turn = Some(ONE_AT_A_TIME.lock_guard());
        }
    });
    let log = NonNull::from(Box::leak(Box::new(bun_ast::Log::init())));
    let file_system = Fs::FileSystem::init(None).expect("the working directory");
    Resolver::init1(log, file_system, options())
}

/// A new directory and a resolver. The directory is removed when the test ends.
struct Project {
    resolver: Resolver<'static>,
    top: Vec<u8>,
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(std::ffi::OsStr::from_bytes(&self.top));
    }
}

fn with_project(name: &str, test: impl FnOnce(&mut Project)) {
    // A `package.json` or `tsconfig.json` that parses goes through the thread's store of trees.
    let arena = bun_alloc::Arena::new();
    let mut trees = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _scope = trees.enter();
    let resolver = resolver();
    let unique_name = format!("bun-resolver-caches-{}-{name}", std::process::id());
    let top = std::env::temp_dir().join(unique_name);
    let _ = std::fs::remove_dir_all(&top);
    std::fs::create_dir_all(&top).expect("directory");
    let top = top.canonicalize().expect("directory");
    let mut project = Project {
        resolver,
        top: top.as_os_str().as_bytes().to_vec(),
    };
    // Another test may have dropped a level above: the first asker that checks links them again.
    project.checked_info("");
    test(&mut project);
}

impl Project {
    fn path(&self, below: &str) -> Vec<u8> {
        let mut path = self.top.clone();
        if !below.is_empty() {
            path.push(b'/');
            path.extend_from_slice(below.as_bytes());
        }
        path
    }

    fn os_path(&self, below: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(std::ffi::OsStr::from_bytes(&self.path(below)))
    }

    fn write(&self, below: &str, contents: &str) {
        let path = self.os_path(below);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("directory");
        std::fs::write(path, contents).expect("file");
    }

    fn mkdir(&self, below: &str) {
        std::fs::create_dir_all(self.os_path(below)).expect("directory");
    }

    fn link(&self, target: &str, below: &str) {
        std::os::unix::fs::symlink(target, self.os_path(below)).expect("link");
    }

    fn remove(&self, below: &str) {
        let path = self.os_path(below);
        let is_directory = std::fs::symlink_metadata(&path).expect("there").is_dir();
        let removed = match is_directory {
            true => std::fs::remove_dir_all(path),
            false => std::fs::remove_file(path),
        };
        removed.expect("removed");
    }

    fn rename(&self, from: &str, to: &str) {
        std::fs::rename(self.os_path(from), self.os_path(to)).expect("renamed");
    }

    #[cfg(target_os = "linux")]
    fn set_mode(&self, below: &str, mode: u32) {
        use std::os::unix::fs::PermissionsExt as _;
        let permissions = std::fs::Permissions::from_mode(mode);
        std::fs::set_permissions(self.os_path(below), permissions).expect("mode");
    }

    /// What an asker of `generation` gets for the directory. Generation 0 trusts what is cached.
    fn info(&mut self, generation: Generation, below: &str) -> Option<DirInfoRef> {
        let dir = self.path(below);
        self.info_at(generation, &dir)
    }

    fn info_at(&mut self, generation: Generation, dir: &[u8]) -> Option<DirInfoRef> {
        self.resolver.generation = generation;
        let info = self.resolver.read_dir_info(dir).expect("readable");
        self.resolver.generation = 0;
        info
    }

    fn checked_info(&mut self, below: &str) -> DirInfoRef {
        self.info(next_generation(), below).expect("a directory")
    }
}

fn slot(info: DirInfoRef) -> *const DirInfo::DirInfo {
    std::ptr::from_ref(&*info)
}

fn real_fs() -> &'static Fs::file_system::RealFS {
    &Fs::FileSystem::get().fs
}

/// What an asker of `generation` gets for the listing of `dir`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Listing {
    at: *const Fs::file_system::DirEntry,
    dir: *const u8,
    stamp: Generation,
    version: u64,
}

fn read_directory(
    dir: &[u8],
    generation: Generation,
) -> &'static Fs::file_system::real_fs::EntriesOption {
    let real_fs = &mut Fs::FileSystem::instance().fs;
    let read = real_fs.read_directory(dir, None, generation, false);
    read.expect("only the directory fails")
}

fn listing(dir: &[u8], generation: Generation) -> Option<Listing> {
    let entries = read_directory(dir, generation).as_entries()?;
    Some(Listing {
        at: std::ptr::from_ref(entries),
        dir: entries.dir.as_ptr(),
        stamp: entries.generation,
        version: version_of(entries),
    })
}

/// The failure that an asker of `generation` gets for `dir`.
fn listing_error(dir: &[u8], generation: Generation) -> Option<crate::Error> {
    match read_directory(dir, generation) {
        Fs::file_system::real_fs::EntriesOption::Err(err) => Some(err.canonical_error),
        Fs::file_system::real_fs::EntriesOption::Entries(_) => None,
    }
}

fn listed(
    dir: &[u8],
    generation: Generation,
    name: &[u8],
) -> Option<&'static Fs::file_system::Entry> {
    let (found, _) = read_directory(dir, generation).lookup(name);
    found.map(|found| found.entry())
}

/// Asks at new generations until one keeps the listing. A directory that changed just now is read.
fn listing_once_kept(dir: &[u8]) -> Listing {
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut last = listing(dir, next_generation()).expect("a directory");
    loop {
        let next = listing(dir, next_generation()).expect("a directory");
        if next.version == last.version {
            return next;
        }
        assert!(
            Instant::now() < deadline,
            "each asker read the unchanged directory again"
        );
        last = next;
        std::thread::yield_now();
    }
}

const ENOENT: crate::Error = crate::Error::Sys(bun_errno::SystemErrno::ENOENT);
const ENOTDIR: crate::Error = crate::Error::Sys(bun_errno::SystemErrno::ENOTDIR);

#[test]
fn a_new_generation_is_never_0_and_is_above_each_one_before_it() {
    let first = next_generation();
    let second = next_generation();
    assert!(first != 0 && second > first);
    let drawn = std::thread::scope(|threads| {
        let draws = [(); 4]
            .map(|()| threads.spawn(|| (0..1000).map(|_| next_generation()).collect::<Vec<_>>()));
        draws.map(|thread| thread.join().expect("no panic"))
    });
    let mut all = Vec::new();
    for of_thread in drawn {
        assert!(of_thread.is_sorted_by(|earlier, later| earlier < later));
        all.extend(of_thread);
    }
    all.sort_unstable();
    all.dedup();
    assert_eq!(all.len(), 4000);
    assert!(all[0] > second);
}

#[test]
fn sizes_of_what_the_caches_hold() {
    use core::mem::size_of;
    let sizes = [
        size_of::<Fs::file_system::DirEntry>(),
        size_of::<Fs::file_system::Entry>(),
        size_of::<DirInfo::DirInfo>(),
    ];
    // On main 3f3a9ff87c: 56, 152 and 104. The mutex of an `Entry` is larger with debug assertions.
    #[cfg(all(target_os = "linux", target_pointer_width = "64", debug_assertions))]
    assert_eq!(
        sizes,
        [88, 152, 128],
        "DirEntry, Entry and DirInfo in bytes"
    );
    let _ = sizes;
}

#[test]
fn an_asker_trusts_a_listing_of_its_own_generation() {
    with_project("own-stamp", |made| {
        made.write("src/a.js", "");
        let dir = made.path("src");
        let own = next_generation();
        let first = listing(&dir, own).expect("a directory");
        assert_eq!(first.stamp, own);
        // No look at the disk: the name that came since is not there for this asker.
        made.write("src/late.js", "");
        assert_eq!(listing(&dir, own), Some(first));
        assert!(listed(&dir, own, b"late.js").is_none());
        // The asker that trusts what is cached takes it too, and leaves the stamp.
        assert_eq!(listing(&dir, 0), Some(first));
        assert!(listed(&dir, 0, b"late.js").is_none());
    });
}

#[test]
fn an_asker_reads_a_changed_directory_again_in_place() {
    with_project("in-place", |made| {
        made.write("src/a.js", "");
        made.write("src/b.js", "");
        let dir = made.path("src");
        let first = listing(&dir, next_generation()).expect("a directory");
        let b = listed(&dir, first.stamp, b"b.js").expect("listed");
        let (_, new_listings, _) = counters();
        made.write("src/late.js", "");
        made.remove("src/a.js");
        let later = next_generation();
        // The other spelling of the directory names the same listing.
        let again = listing(&[&dir[..], b"/"].concat(), later).expect("a directory");
        assert_eq!(
            (again.at, again.dir, again.stamp),
            (first.at, first.dir, later)
        );
        assert_ne!(again.version, first.version);
        assert!(listed(&dir, later, b"late.js").is_some());
        assert!(listed(&dir, later, b"a.js").is_none());
        assert!(std::ptr::eq(
            listed(&dir, later, b"b.js").expect("listed"),
            b
        ));
        assert_eq!(counters().1, new_listings);
    });
}

#[test]
fn an_older_asker_does_not_trust_a_newer_stamp() {
    with_project("older-asker", |made| {
        made.write("src/a.js", "");
        let dir = made.path("src");
        let (older, newer) = (next_generation(), next_generation());
        assert_eq!(listing(&dir, newer).expect("a directory").stamp, newer);
        made.write("src/late.js", "");
        assert!(listed(&dir, older, b"late.js").is_some());
        assert_eq!(listing(&dir, older).expect("a directory").stamp, older);
        assert_eq!(listing(&dir, newer).expect("a directory").stamp, newer);
    });
}

#[test]
fn an_unchanged_directory_is_kept_and_stamped_again() {
    with_project("kept", |made| {
        made.write("src/a.js", "");
        let dir = made.path("src");
        let a = listed(&dir, next_generation(), b"a.js").expect("listed");
        let kept = listing_once_kept(&dir);
        let (_, new_listings, refills) = counters();
        let later = next_generation();
        let again = listing(&dir, later).expect("a directory");
        assert_eq!(
            again,
            Listing {
                stamp: later,
                ..kept
            }
        );
        let (_, new_listings_now, refills_now) = counters();
        assert_eq!((new_listings_now, refills_now), (new_listings, refills));
        assert!(std::ptr::eq(
            listed(&dir, later, b"a.js").expect("listed"),
            a
        ));
        // A kept listing is not kept for good.
        made.write("src/late.js", "");
        let after = next_generation();
        assert!(listed(&dir, after, b"late.js").is_some());
        assert_ne!(
            listing(&dir, after).expect("a directory").version,
            kept.version
        );
    });
}

#[test]
fn a_directory_stamped_in_whole_seconds_is_kept_two_seconds_after_its_last_change() {
    const SECOND: i64 = 1_000_000_000;
    let (clock, lead) = bun_sys::file_stamp_clock_ns();
    let mut listing = Fs::file_system::DirEntry::init(b"/", 1);
    listing.dot_ino = 7;
    listing.read_clock_ns = clock;
    listing.read_clock_lead_ns = lead;
    let kept = |ino: u64, stamp: i64| {
        let mut now = bun_core::ffi::zeroed::<bun_sys::PosixStat>();
        now.ino = ino;
        let time = bun_core::Timespec {
            sec: stamp / SECOND,
            nsec: stamp % SECOND,
        };
        (now.mtim, now.ctim) = (time, time);
        listing.unchanged_since_read(&now)
    };
    // A fine stamp is never on a whole millisecond here.
    let fine = |before_read: i64| ((clock - before_read) / 1_000_000) * 1_000_000 + 1;
    let whole_second = |before_read: i64| ((clock - before_read) / SECOND) * SECOND;
    assert!(kept(7, fine(SECOND)));
    assert!(!kept(7, fine(10_000_000)));
    // A file system that keeps whole seconds stamps a change up to two seconds before it.
    assert!(!kept(7, whole_second(SECOND)));
    assert!(kept(7, whole_second(4 * SECOND)));
    assert!(!kept(7, 0));
    assert!(!kept(8, fine(SECOND)));
}

#[test]
fn a_listing_read_before_the_wall_clock_was_set_back_is_read_again() {
    with_project("clock-set-back", |made| {
        made.write("src/a.js", "");
        let dir = made.path("src");
        let kept = listing_once_kept(&dir);
        // As after a wall clock set back by one second: its lead over the monotonic clock was larger at the read.
        {
            let real_fs = &mut Fs::FileSystem::instance().fs;
            let _entries_unlock = real_fs.entries_mutex.lock_guard();
            let Some(Fs::file_system::real_fs::EntriesOption::Entries(entries)) =
                real_fs.entries.get(&dir)
            else {
                panic!("a listing");
            };
            entries.read_clock_lead_ns += 1_000_000_000;
        }
        let read_again = listing(&dir, next_generation()).expect("a directory");
        assert_eq!(read_again.version, kept.version + 1);
        // The read took the clocks as they are now.
        assert_eq!(listing_once_kept(&dir).version, read_again.version);
    });
}

#[test]
fn a_link_that_is_statted_again_keeps_the_path_that_was_interned_for_it() {
    with_project("link-path-kept", |made| {
        made.write("src/a.txt", "");
        made.write("src/b.txt", "");
        made.link("a.txt", "src/link");
        let dir = made.path("src");
        let link = listed(&dir, next_generation(), b"link").expect("listed");
        let first = link.symlink_for(next_generation(), real_fs(), false);
        assert_eq!(
            bstr::BStr::new(first),
            bstr::BStr::new(&made.path("src/a.txt"))
        );
        let again = link.symlink_for(next_generation(), real_fs(), false);
        assert!(std::ptr::eq(first, again));
        // A link that names another file now gets that path.
        made.remove("src/link");
        made.link("b.txt", "src/link");
        let other = link.symlink_for(next_generation(), real_fs(), false);
        assert_eq!(
            bstr::BStr::new(other),
            bstr::BStr::new(&made.path("src/b.txt"))
        );
    });
}

#[test]
fn the_first_listing_of_a_directory_is_kept_by_the_first_asker_that_checks_it() {
    with_project("first-listing", |made| {
        const ATTEMPTS: u32 = 15;
        for attempt in 0..ATTEMPTS {
            made.write(&format!("listed{attempt}/a.js"), "");
            made.write(&format!("walked{attempt}/a.js"), "");
        }
        let made_at = Instant::now();
        for attempt in 0..ATTEMPTS {
            // Each attempt lets the directories get twice as old before their first listing.
            while made_at.elapsed() < Duration::from_millis(1 << attempt) {
                std::thread::yield_now();
            }
            let listed_dir = made.path(&format!("listed{attempt}"));
            let first = listing(&listed_dir, 0).expect("a directory");
            let checked = listing(&listed_dir, next_generation()).expect("a directory");
            let walked_dir = made.path(&format!("walked{attempt}"));
            made.info(0, &format!("walked{attempt}"))
                .expect("a directory");
            let walked = listing(&walked_dir, 0).expect("a directory");
            let walked_checked = listing(&walked_dir, next_generation()).expect("a directory");
            if checked.version == first.version && walked_checked.version == walked.version {
                assert_eq!((checked.at, walked_checked.at), (first.at, walked.at));
                return;
            }
        }
        panic!("no first listing was kept by the first asker that checked it");
    });
}

#[test]
fn a_directory_behind_a_link_that_leads_elsewhere_now_is_read_again() {
    with_project("other-directory", |made| {
        made.write("releases/1/src/a.js", "");
        made.write("releases/2/src/a.js", "");
        made.write("releases/2/src/new.js", "");
        made.link("releases/1", "current");
        let dir = made.path("current/src");
        let kept = listing_once_kept(&dir);
        // Neither directory changes, and both are as old as the listing that was kept.
        made.remove("current");
        made.link("releases/2", "current");
        let later = next_generation();
        assert!(listed(&dir, later, b"new.js").is_some());
        let again = listing(&dir, later).expect("a directory");
        assert_eq!((again.at, again.stamp), (kept.at, later));
        assert_ne!(again.version, kept.version);
    });
}

#[test]
fn a_directory_that_was_not_there_is_opened_again_by_an_asker_that_checks() {
    with_project("not-there", |made| {
        let dir = made.path("late");
        assert_eq!(listing_error(&dir, 0), Some(ENOENT));
        made.write("late/a.js", "");
        assert_eq!(listing_error(&dir, 0), Some(ENOENT));
        assert!(listed(&dir, next_generation(), b"a.js").is_some());
        assert!(listed(&dir, 0, b"a.js").is_some());
    });
}

#[test]
fn a_path_that_could_not_be_listed_is_opened_again_once_for_each_generation() {
    with_project("not-a-directory", |made| {
        made.write("thing", "");
        let dir = made.path("thing");
        let own = next_generation();
        assert_eq!(listing_error(&dir, own), Some(ENOTDIR));
        made.remove("thing");
        made.write("thing/a.js", "");
        // The failure has the stamp of the asker that met it: that asker takes it as it is, and so does one that trusts what is cached.
        assert_eq!(listing_error(&dir, own), Some(ENOTDIR));
        assert_eq!(listing_error(&dir, 0), Some(ENOTDIR));
        assert!(listed(&dir, next_generation(), b"a.js").is_some());
        assert_eq!(listing_error(&dir, 0), None);
    });
}

#[test]
fn a_listing_read_again_keeps_an_entry_only_under_the_same_spelling() {
    with_project("spelling", |made| {
        made.write("src/foo.js", "");
        made.write("src/bar.js", "");
        let dir = made.path("src");
        let first = next_generation();
        let foo = listed(&dir, first, b"foo.js").expect("listed");
        let bar = listed(&dir, first, b"bar.js").expect("listed");
        made.rename("src/foo.js", "src/Foo.js");
        let later = next_generation();
        let renamed = listed(&dir, later, b"foo.js").expect("found under any case");
        assert_eq!(bstr::BStr::new(renamed.base()), "Foo.js");
        assert!(!std::ptr::eq(renamed, foo));
        assert!(std::ptr::eq(
            listed(&dir, later, b"bar.js").expect("listed"),
            bar
        ));
    });
}

#[test]
fn an_entry_that_was_a_link_is_statted_again_when_it_is_listed_again() {
    with_project("link-memo", |made| {
        made.write("src/a.txt", "");
        made.write("src/b.txt", "");
        made.link("a.txt", "src/to-file");
        made.link("a.txt", "src/to-other");
        let dir = made.path("src");
        let first = next_generation();
        for name in [&b"to-file"[..], b"to-other"] {
            let link = listed(&dir, first, name).expect("listed");
            assert_eq!(
                link.kind(real_fs(), false),
                Fs::file_system::EntryKind::File
            );
            assert_eq!(
                bstr::BStr::new(link.symlink(real_fs(), false)),
                bstr::BStr::new(&made.path("src/a.txt"))
            );
            assert!(is_link(link));
        }
        made.remove("src/to-file");
        made.write("src/to-file", "");
        made.remove("src/to-other");
        made.link("b.txt", "src/to-other");
        let later = next_generation();
        let file = listed(&dir, later, b"to-file").expect("listed");
        assert_eq!(bstr::BStr::new(file.symlink(real_fs(), false)), "");
        assert!(!is_link(file));
        let other = listed(&dir, later, b"to-other").expect("listed");
        assert_eq!(
            bstr::BStr::new(other.symlink(real_fs(), false)),
            bstr::BStr::new(&made.path("src/b.txt"))
        );
        assert!(is_link(other));
    });
}

#[test]
fn an_asker_that_checks_keeps_the_slot_of_an_unchanged_directory() {
    with_project("same-slot", |made| {
        made.write("app/package.json", r#"{ "name": "app" }"#);
        made.write(
            "app/tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@a/*": ["./a/*"] } } }"#,
        );
        made.mkdir("app/node_modules");
        made.mkdir("app/src");
        made.info(0, "app/src").expect("a directory");
        let (src, app) = (made.checked_info("app/src"), made.checked_info("app"));
        let slots = DirInfo::slots_used();
        for _ in 0..3 {
            let asker = next_generation();
            let again = made.info(asker, "app/src").expect("a directory");
            assert_eq!((slot(again), stamp_of(again)), (slot(src), asker));
            assert_eq!(again.get_parent().map(slot), Some(slot(app)));
            assert_eq!(made.info(asker, "app").map(slot), Some(slot(app)));
        }
        assert_eq!(DirInfo::slots_used(), slots);
        let listing_of_slot = src.get_entries_const().map(std::ptr::from_ref);
        let listed = listing(&made.path("app/src"), 0).map(|listing| listing.at);
        assert_eq!(listing_of_slot, listed);
    });
}

#[test]
fn an_asker_trusts_a_slot_of_its_own_generation() {
    with_project("own-slot", |made| {
        made.write("app/package.json", r#"{ "name": "one" }"#);
        let own = next_generation();
        let first = made.info(own, "app").expect("a directory");
        made.write("app/package.json", r#"{ "name": "two" }"#);
        made.mkdir("app/node_modules");
        assert_eq!(made.info(own, "app").map(slot), Some(slot(first)));
        assert_eq!(made.info(0, "app").map(slot), Some(slot(first)));
        let later = made.checked_info("app");
        assert_ne!(slot(later), slot(first));
        assert_eq!(
            bstr::BStr::new(&later.package_json().expect("parsed").name),
            "two"
        );
        assert!(later.has_node_modules());
    });
}

#[test]
fn an_older_asker_checks_a_slot_that_a_newer_one_stamped() {
    with_project("older-slot", |made| {
        made.write("app/package.json", r#"{ "name": "one" }"#);
        let (older, newer) = (next_generation(), next_generation());
        let first = made.info(newer, "app").expect("a directory");
        made.write("app/package.json", r#"{ "name": "two" }"#);
        let checked = made.info(older, "app").expect("a directory");
        assert_ne!(slot(checked), slot(first));
        assert_eq!(
            bstr::BStr::new(&checked.package_json().expect("parsed").name),
            "two"
        );
    });
}

#[test]
fn a_changed_package_json_gives_a_new_slot_and_the_old_one_stays_as_it_was() {
    with_project("package-json", |made| {
        made.write("app/package.json", r#"{ "name": "one" }"#);
        made.mkdir("app/src");
        let name = |info: DirInfoRef| info.package_json().map(|json| bstr::BStr::new(&json.name));
        let enclosing = |info: DirInfoRef| {
            info.enclosing_package_json
                .map(|json| bstr::BStr::new(&json.name))
        };
        let (old, old_below) = (made.checked_info("app"), made.checked_info("app/src"));
        // As many bytes as before: only the bytes tell.
        made.write("app/package.json", r#"{ "name": "two" }"#);
        let asker = next_generation();
        let below = made.info(asker, "app/src").expect("a directory");
        let new = made.info(asker, "app").expect("a directory");
        assert!(slot(new) != slot(old) && slot(below) != slot(old_below));
        // The cache maps the directory to the new slot, for the asker that trusts what is cached too.
        assert_eq!(made.info(0, "app").map(slot), Some(slot(new)));
        assert_eq!(
            (name(new), enclosing(below)),
            (Some("two".into()), Some("two".into()))
        );
        assert_eq!(below.get_parent().map(slot), Some(slot(new)));
        assert_eq!(
            (name(old), enclosing(old_below)),
            (Some("one".into()), Some("one".into()))
        );
        assert_eq!(old_below.get_parent().map(slot), Some(slot(old)));
        made.remove("app/package.json");
        let without = made.checked_info("app");
        assert!(slot(without) != slot(new) && without.package_json().is_none());
        made.write("app/package.json", r#"{ "name": "three" }"#);
        assert_eq!(name(made.checked_info("app")), Some("three".into()));
        assert_eq!(name(new), Some("two".into()));
    });
}

#[test]
fn a_node_modules_directory_that_comes_or_goes_gives_a_new_slot() {
    with_project("node-modules", |made| {
        made.mkdir("app/src");
        made.mkdir("app/other");
        let none = made.checked_info("app");
        assert!(!none.has_node_modules());
        made.mkdir("app/node_modules");
        let some = made.checked_info("app");
        assert!(slot(some) != slot(none) && some.has_node_modules());
        made.remove("app/node_modules");
        made.write("app/node_modules", "a file");
        let file = made.checked_info("app");
        assert!(slot(file) != slot(some) && !file.has_node_modules());
        made.remove("app/node_modules");
        made.link("other", "app/node_modules");
        let link = made.checked_info("app");
        assert!(slot(link) != slot(file) && link.has_node_modules());
        assert!(!none.has_node_modules() && some.has_node_modules());
    });
}

#[test]
fn a_listing_that_takes_the_place_of_a_failure_gives_a_new_slot() {
    with_project("failed-then-listed", |made| {
        made.write("app/a.js", "");
        let built = made.checked_info("app");
        assert!(!built.has_node_modules() && built.package_json().is_none());
        let dir = made.path("app");
        made.remove("app");
        made.write("app", "");
        // The failure takes the place of the listing, in the slot that `built` holds by index.
        assert_eq!(listing_error(&dir, next_generation()), Some(ENOTDIR));
        made.remove("app");
        made.write("app/package.json", r#"{ "name": "late" }"#);
        made.mkdir("app/node_modules");
        let later = next_generation();
        // Read by key before the slot is checked: the new listing takes the place of the failure.
        assert!(listed(&dir, later, b"package.json").is_some());
        let now = made.info(later, "app").expect("a directory");
        assert_ne!(slot(now), slot(built));
        assert!(now.has_node_modules());
        assert_eq!(
            bstr::BStr::new(&now.package_json().expect("parsed").name),
            "late"
        );
    });
}

#[test]
fn a_changed_tsconfig_or_a_file_that_it_extends_gives_a_new_slot() {
    with_project("tsconfig", |made| {
        made.write(
            "app/base.json",
            r#"{ "compilerOptions": { "paths": { "@a/*": ["./a/*"] } } }"#,
        );
        made.write("app/tsconfig.json", r#"{ "extends": "./base.json" }"#);
        made.mkdir("app/src");
        let aliases = |info: DirInfoRef| -> Vec<&'static [u8]> {
            let config = info.enclosing_tsconfig_json.expect("a tsconfig");
            config.paths.keys().iter().map(|key| &key[..]).collect()
        };
        let (old, old_below) = (made.checked_info("app"), made.checked_info("app/src"));
        assert_eq!(aliases(old_below), [b"@a/*"]);
        made.write(
            "app/base.json",
            r#"{ "compilerOptions": { "paths": { "@b/*": ["./b/*"] } } }"#,
        );
        let below = made.checked_info("app/src");
        assert!(slot(below) != slot(old_below) && below.get_parent().map(slot) != Some(slot(old)));
        assert_eq!(
            (aliases(below), aliases(old_below)),
            (vec![&b"@b/*"[..]], vec![&b"@a/*"[..]])
        );
        made.write(
            "app/tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@c/*": ["./c/*"] } } }"#,
        );
        assert_eq!(aliases(made.checked_info("app/src")), [b"@c/*"]);
        made.write(
            "app/jsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@j/*": ["./j/*"] } } }"#,
        );
        made.remove("app/tsconfig.json");
        assert_eq!(aliases(made.checked_info("app/src")), [b"@j/*"]);
        made.remove("app/jsconfig.json");
        // No config file is left in `app`: its directories have what the directory of the project has.
        let without = made.checked_info("app/src");
        let above = made.checked_info("");
        assert_eq!(
            without.enclosing_tsconfig_json.map(std::ptr::from_ref),
            above.enclosing_tsconfig_json.map(std::ptr::from_ref)
        );
    });
}

#[test]
fn a_config_that_does_not_parse_costs_no_slot_when_it_is_checked_again() {
    with_project("unparsed", |made| {
        made.write("app/package.json", r#"{ "name": "#);
        made.write("app/lib/tsconfig.json", r#"{ "compilerOptions": "#);
        made.mkdir("app/lib/src");
        made.checked_info("app/lib/src");
        // One for each file, from the asker that filled the slots.
        assert_eq!(made.resolver.log_ref().errors, 2);
        let chain = ["app", "app/lib", "app/lib/src"];
        let first = chain.map(|dir| slot(made.checked_info(dir)));
        let slots = DirInfo::slots_used();
        for _ in 0..5 {
            made.resolver.log_mut().msgs.clear();
            made.resolver.log_mut().errors = 0;
            let asker = next_generation();
            let again = chain.map(|dir| made.info(asker, dir).map(slot));
            assert_eq!(again, first.map(Some));
            // An asker that checks the slots is told once what the files are missing.
            assert_eq!(made.resolver.log_ref().errors, 2);
        }
        assert_eq!(DirInfo::slots_used(), slots);
        made.write("app/package.json", r#"{ "name": "app" }"#);
        let parsed = made.checked_info("app");
        assert!(slot(parsed) != first[0] && parsed.package_json().is_some());
    });
}

#[test]
fn a_tsconfig_that_extends_in_a_circle_is_read_again_once_the_circle_ends() {
    with_project("extends-circle", |made| {
        made.write("app/tsconfig.json", r#"{ "extends": "./base.json" }"#);
        made.write("app/base.json", r#"{ "extends": "./tsconfig.json" }"#);
        let dir = made.path("app");
        // The asker that fills the slot is told that the chain has no end, and the slot stays.
        made.resolver.generation = next_generation();
        let filled = made.resolver.read_dir_info(&dir);
        made.resolver.generation = 0;
        assert!(filled.is_err());
        let first = made.checked_info("app");
        assert!(first.tsconfig_json().is_none());
        let slots = DirInfo::slots_used();
        for _ in 0..3 {
            assert_eq!(slot(made.checked_info("app")), slot(first));
        }
        assert_eq!(DirInfo::slots_used(), slots);
        // The chain ends in the file that is extended: `tsconfig.json` holds the bytes that it held.
        made.write("app/base.json", "{}");
        let ended = made.checked_info("app");
        assert!(slot(ended) != slot(first) && ended.tsconfig_json().is_some());
    });
}

#[test]
fn a_directory_that_was_not_there_is_found_once_its_name_is_listed() {
    with_project("mark", |made| {
        made.mkdir("app");
        assert!(made.info(0, "app/late").is_none() && made.info(0, "app/late/deep").is_none());
        let slots = DirInfo::slots_used();
        for _ in 0..3 {
            let asker = next_generation();
            assert!(
                made.info(asker, "app/late/deep").is_none()
                    && made.info(asker, "app/late").is_none()
            );
        }
        assert_eq!(DirInfo::slots_used(), slots);
        made.mkdir("app/late/deep");
        assert!(made.info(0, "app/late/deep").is_none() && made.info(0, "app/late").is_none());
        let asker = next_generation();
        let deep = made.info(asker, "app/late/deep").expect("a directory now");
        let late = made.info(asker, "app/late").expect("a directory now");
        assert_eq!(deep.get_parent().map(slot), Some(slot(late)));
        made.remove("app/late");
        let asker = next_generation();
        assert!(
            made.info(asker, "app/late/deep").is_none() && made.info(asker, "app/late").is_none()
        );
        assert!(made.info(0, "app/late").is_none());
        let own = next_generation();
        assert!(made.info(own, "app/other").is_none());
        made.mkdir("app/other");
        // The listing of `app` that this asker trusts lacks the name: the mark holds, though the directory is there now.
        assert!(made.info(own, "app/other").is_none());
        assert!(made.info(next_generation(), "app/other").is_some());
    });
}

#[test]
fn an_asker_that_a_mark_answers_is_told_what_a_config_above_the_mark_is_missing() {
    with_project("mark-config", |made| {
        made.write("app/package.json", r#"{ "name": "#);
        // The asker that fills `app` marks the directory that is not below it.
        assert!(made.info(next_generation(), "app/none").is_none());
        assert_eq!(made.resolver.log_ref().errors, 1);
        for _ in 0..3 {
            made.resolver.log_mut().msgs.clear();
            made.resolver.log_mut().errors = 0;
            assert!(made.info(next_generation(), "app/none").is_none());
            assert_eq!(made.resolver.log_ref().errors, 1);
        }
    });
}

#[test]
fn a_directory_behind_a_link_that_leads_elsewhere_now_gets_a_new_real_path() {
    with_project("real-path", |made| {
        made.write("releases/1/src/a.js", "");
        made.write("releases/2/src/a.js", "");
        made.write("releases/2/src/new.js", "");
        made.link("releases/1", "current");
        let real_path = |info: DirInfoRef| bstr::BStr::new(info.abs_real_path);
        let old = made.checked_info("current/src");
        assert_eq!(
            real_path(old),
            bstr::BStr::new(&made.path("releases/1/src"))
        );
        made.remove("current");
        made.link("releases/2", "current");
        let asker = next_generation();
        let new = made.info(asker, "current/src").expect("a directory");
        assert_ne!(slot(new), slot(old));
        assert_eq!(
            real_path(new),
            bstr::BStr::new(&made.path("releases/2/src"))
        );
        assert!(listed(&made.path("current/src"), asker, b"new.js").is_some());
        assert_eq!(
            real_path(old),
            bstr::BStr::new(&made.path("releases/1/src"))
        );
    });
}

#[test]
fn a_directory_below_the_renamed_target_of_a_link_gets_a_new_real_path() {
    with_project("renamed-target", |made| {
        made.write("data/a/x/y/f.js", "");
        made.link("data/a", "link");
        let real_path = |info: DirInfoRef| bstr::BStr::new(info.abs_real_path);
        // Old before a slot joins a real path below them, and not changed after: each asker keeps these listings, with the paths that their entries hold.
        listing_once_kept(&made.path("link/x/"));
        listing_once_kept(&made.path("link/x/y/"));
        let old = made.checked_info("link/x/y");
        assert_eq!(real_path(old), bstr::BStr::new(&made.path("data/a/x/y")));
        made.rename("data/a", "data/b");
        made.remove("link");
        made.link("data/b", "link");
        let asker = next_generation();
        let new = made.info(asker, "link/x/y").expect("a directory");
        let above = made.info(asker, "link/x").expect("a directory");
        assert_ne!(slot(new), slot(old));
        assert_eq!(real_path(above), bstr::BStr::new(&made.path("data/b/x")));
        assert_eq!(real_path(new), bstr::BStr::new(&made.path("data/b/x/y")));
    });
}

#[test]
fn an_asker_with_its_own_tsconfig_leaves_a_new_tsconfig_to_the_next_asker() {
    with_project("own-tsconfig", |made| {
        made.mkdir("app/src");
        made.write("other/tsconfig.json", r#"{ "compilerOptions": {} }"#);
        let old = made.checked_info("app");
        assert!(old.tsconfig_json().is_none());
        made.write(
            "app/tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@a/*": ["./a/*"] } } }"#,
        );
        // Each asker below keeps the listing that was read again: only the version that the slot holds tells that it was.
        listing_once_kept(&made.path("app"));
        let mut build = resolver();
        build.opts.tsconfig_override = Some(made.path("other/tsconfig.json").into_boxed_slice());
        build.generation = next_generation();
        // It reads its own tsconfig in place of each one on the way, so it keeps the slot.
        let seen = build.read_dir_info(&made.path("app")).expect("readable");
        assert_eq!(seen.map(slot), Some(slot(old)));
        let now = made.checked_info("app");
        assert!(slot(now) != slot(old) && now.tsconfig_json().is_some());
    });
}

#[test]
fn a_slot_filled_without_config_files_is_kept_by_an_asker_that_reads_them() {
    with_project("filled-without-config", |made| {
        made.write("app/package.json", r#"{ "name": "app" }"#);
        made.write("app/tsconfig.json", r#"{ "compilerOptions": {} }"#);
        // As the resolver of an executable that does not load these files: it fills the slot first.
        let mut runtime = resolver();
        runtime.opts.load_package_json = false;
        runtime.opts.load_tsconfig_json = false;
        let filled = runtime
            .read_dir_info(&made.path("app"))
            .expect("readable")
            .expect("a directory");
        assert!(filled.package_json().is_none() && filled.tsconfig_json().is_none());
        // A build that reads them checks the slot and takes it as it is.
        let kept = made.checked_info("app");
        assert_eq!(slot(kept), slot(filled));
        assert!(kept.package_json().is_none() && kept.tsconfig_json().is_none());
    });
}

#[test]
fn an_asker_that_preserves_symlinks_leaves_a_new_real_path_to_the_next_asker() {
    with_project("preserved-links", |made| {
        made.write("releases/1/a.js", "");
        made.write("releases/2/a.js", "");
        made.link("releases/1", "current");
        let real_path = |info: DirInfoRef| bstr::BStr::new(info.abs_real_path);
        let old = made.checked_info("current");
        assert_eq!(real_path(old), bstr::BStr::new(&made.path("releases/1")));
        made.remove("current");
        made.link("releases/2", "current");
        // Each asker below keeps both listings that were read again: only the versions that the slot holds tell that they were.
        listing_once_kept(&made.path(""));
        listing_once_kept(&made.path("current"));
        let mut preserving = resolver();
        preserving.opts.preserve_symlinks = true;
        preserving.generation = next_generation();
        // It takes no real path from the slot, so it keeps the slot.
        let seen = preserving
            .read_dir_info(&made.path("current"))
            .expect("readable");
        assert_eq!(seen.map(slot), Some(slot(old)));
        let now = made.checked_info("current");
        assert_eq!(real_path(now), bstr::BStr::new(&made.path("releases/2")));
    });
}

#[test]
fn a_lookup_that_misses_runs_once_more_unless_it_trusts_cached_misses() {
    with_project("funnel", |made| {
        made.write("src/a.js", "");
        made.mkdir("node_modules");
        let dir = [&made.path("src")[..], b"/"].concat();
        let stmt = ast::ImportKind::Stmt;
        let specifiers = [&b"./late.js"[..], b"late/index.js"];
        let mut trusting = resolver();
        trusting.trust_cached_misses();
        let told = AfterMiss::TrustCache;
        let ran_again = || counters().0;
        let before = ran_again();
        assert!(made.resolver.resolve(&dir, b"./a.js", stmt).is_ok());
        assert_eq!(ran_again(), before);
        for specifier in specifiers {
            assert!(made.resolver.resolve(&dir, specifier, stmt).is_err());
        }
        assert_eq!(ran_again(), before + 2);
        made.write("src/late.js", "");
        made.write("node_modules/late/index.js", "");
        // The caches say that neither is there. A resolver that trusts them asks once, and so does a lookup that is told to.
        for specifier in specifiers {
            assert!(trusting.resolve(&dir, specifier, stmt).is_err());
            let as_told = made.resolver.resolve_as(&dir, specifier, stmt, told);
            assert!(as_told.is_err());
        }
        assert_eq!(ran_again(), before + 2);
        for specifier in specifiers {
            assert!(made.resolver.resolve(&dir, specifier, stmt).is_ok());
        }
        assert_eq!(ran_again(), before + 4);
        assert_eq!(made.resolver.generation, 0);
    });
}

#[test]
fn a_lookup_that_runs_again_stats_a_link_again_though_its_listing_is_kept() {
    with_project("link-target", |made| {
        made.mkdir("src");
        made.link("../late.js", "src/link.js");
        let dir = [&made.path("src")[..], b"/"].concat();
        let stmt = ast::ImportKind::Stmt;
        assert!(made.resolver.resolve(&dir, b"./link.js", stmt).is_err());
        let kept = listing_once_kept(&made.path("src"));
        // A listing that is read again asks for a stat of its links. This miss takes it.
        assert!(made.resolver.resolve(&dir, b"./link.js", stmt).is_err());
        made.write("late.js", "");
        let mut trusting = resolver();
        trusting.trust_cached_misses();
        assert!(trusting.resolve(&dir, b"./link.js", stmt).is_err());
        let found = made
            .resolver
            .resolve(&dir, b"./link.js", stmt)
            .expect("found");
        assert_eq!(
            bstr::BStr::new(found.path_const().expect("a path").text),
            bstr::BStr::new(&made.path("late.js"))
        );
        assert_eq!(
            listing(&made.path("src"), 0).map(|listing| listing.version),
            Some(kept.version)
        );
    });
}

#[test]
fn a_lookup_that_runs_again_and_finds_its_module_keeps_what_a_config_is_missing() {
    with_project("config-error", |made| {
        made.write("app/package.json", r#"{ "name": "#);
        made.mkdir("app/src");
        let dir = [&made.path("app/src")[..], b"/"].concat();
        let stmt = ast::ImportKind::Stmt;
        assert!(made.resolver.resolve(&dir, b"./late.js", stmt).is_err());
        assert_eq!(made.resolver.log_ref().errors, 1);
        made.write("app/src/late.js", "");
        // As a build does: each one has its own log.
        made.resolver.log_mut().msgs.clear();
        made.resolver.log_mut().errors = 0;
        assert!(made.resolver.resolve(&dir, b"./late.js", stmt).is_ok());
        let log = made.resolver.log_ref();
        assert_eq!((log.errors, log.msgs.len()), (1, 1));
        assert_eq!(
            bstr::BStr::new(&log.msgs[0].data.text),
            "Unexpected end of file"
        );
    });
}

#[test]
fn a_module_that_a_rerun_finds_in_a_new_directory_gets_the_package_json_above_it() {
    with_project("rerun-finalize", |made| {
        made.write("app/package.json", r#"{ "name": "app", "type": "module" }"#);
        made.mkdir("app/src");
        let dir = [&made.path("app/src")[..], b"/"].concat();
        let stmt = ast::ImportKind::Stmt;
        assert!(made.resolver.resolve(&dir, b"./late/a.js", stmt).is_err());
        // The miss left a mark in the cache: `app/src/late` is no directory.
        assert!(made.info(0, "app/src/late").is_none());
        made.write("app/src/late/a.js", "");
        let found = made
            .resolver
            .resolve(&dir, b"./late/a.js", stmt)
            .expect("found");
        let package = found.package_json;
        assert_eq!(found.module_type, options::ModuleType::Esm);
        assert_eq!(
            package.map(|json| bstr::BStr::new(&json.name)),
            Some("app".into())
        );
        // The asker of the rerun replaced the mark: an asker that trusts what is cached gets the directory, and the next lookup says the same.
        assert!(made.info(0, "app/src/late").is_some());
        let again = made
            .resolver
            .resolve(&dir, b"./late/a.js", stmt)
            .expect("found");
        assert_eq!(again.module_type, options::ModuleType::Esm);
    });
}

#[test]
fn a_module_below_a_directory_that_failed_for_an_earlier_build_gets_the_package_json_above_it() {
    with_project("failed-for-a-build", |made| {
        made.write("package.json", r#"{ "name": "top", "type": "module" }"#);
        made.write("src/a", "");
        let dir = [&made.path("src")[..], b"/"].concat();
        let stmt = ast::ImportKind::Stmt;
        // As a build does: its lookups check at the generation of the build.
        made.resolver.generation = next_generation();
        assert!(made.resolver.resolve(&dir, b"./a/x.js", stmt).is_err());
        assert_eq!(listing_error(&made.path("src/a"), 0), Some(ENOTDIR));
        made.remove("src/a");
        made.write("src/a/sub/x.js", "");
        for build in 0..3 {
            let slots = DirInfo::slots_used();
            made.resolver.generation = next_generation();
            let found = made
                .resolver
                .resolve(&dir, b"./a/sub/x.js", stmt)
                .expect("found");
            let package = found.package_json;
            assert_eq!(found.module_type, options::ModuleType::Esm);
            assert_eq!(
                package.map(|json| bstr::BStr::new(&json.name)),
                Some("top".into())
            );
            // The first of these builds opens `src/a` again and fills its slot. The next ones keep it.
            assert!(build == 0 || DirInfo::slots_used() == slots);
        }
        let (sub, a) = (made.info(0, "src/a/sub"), made.info(0, "src/a"));
        assert!(a.is_some());
        assert_eq!(sub.and_then(|sub| sub.get_parent()).map(slot), a.map(slot));
    });
}

#[test]
fn a_lookup_that_runs_again_opens_a_directory_that_failed_for_an_earlier_asker() {
    with_project("failed-for-a-lookup", |made| {
        made.write("node_modules/dep/index.js", "");
        made.write("thing", "");
        let top = [&made.path("")[..], b"/"].concat();
        let stmt = ast::ImportKind::Stmt;
        assert!(made.resolver.resolve(&top, b"./thing/x.js", stmt).is_err());
        made.remove("thing");
        made.write("thing/sub/y.js", "");
        // This lookup finds its module, so it trusts what is cached: that `thing` cannot be listed.
        assert!(
            made.resolver
                .resolve(&top, b"./thing/sub/y.js", stmt)
                .is_ok()
        );
        let sub = [&made.path("thing/sub")[..], b"/"].concat();
        // A miss from below `thing` runs again, and that run opens `thing`: the package above it is reached.
        assert!(made.resolver.resolve(&sub, b"dep/index.js", stmt).is_ok());
        let (below, thing) = (made.info(0, "thing/sub"), made.info(0, "thing"));
        assert!(thing.is_some());
        assert_eq!(
            below.and_then(|below| below.get_parent()).map(slot),
            thing.map(slot)
        );
        let (slots, ran_again) = (DirInfo::slots_used(), counters().0);
        for _ in 0..3 {
            assert!(made.resolver.resolve(&sub, b"dep/index.js", stmt).is_ok());
        }
        assert_eq!((DirInfo::slots_used(), counters().0), (slots, ran_again));
    });
}

#[test]
fn only_the_last_run_of_a_lookup_asks_the_package_manager() {
    with_project("package-manager", |made| {
        made.write(
            "app/tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": "." } }"#,
        );
        made.write("app/lib/one.js", "");
        made.mkdir("app/src");
        let env = Box::leak(Box::new(DotEnv::Loader::init()));
        made.resolver.env_loader = Some(NonNull::from(env));
        let dir = [&made.path("app/src")[..], b"/"].concat();
        let stmt = ast::ImportKind::Stmt;
        // It allows the package manager with or without a `node_modules` directory above the project.
        let allowed = GlobalCache::fallback;
        let counts = || (PACKAGE_MANAGER_ASKED.load(Ordering::Relaxed), counters().0);
        let (asked, ran_again) = counts();
        let one = made
            .resolver
            .resolve_and_auto_install(&dir, b"lib/one.js", stmt, allowed);
        assert!(matches!(one, ResultUnion::Success(_)));
        assert_eq!(counts(), (asked, ran_again));
        made.write("app/lib/two.js", "");
        // The cached listing of `app/lib` lacks the file. The first run does not ask for a package `lib`, and the rerun finds the file.
        let two = made
            .resolver
            .resolve_and_auto_install(&dir, b"lib/two.js", stmt, allowed);
        assert!(matches!(two, ResultUnion::Success(_)));
        assert_eq!(counts(), (asked, ran_again + 1));
        // Nothing on disk has the name: the rerun asks, once.
        let nowhere: &[u8] = b"bun-resolver-tests-no-such-package";
        let missing = made
            .resolver
            .resolve_and_auto_install(&dir, nowhere, stmt, allowed);
        assert!(matches!(missing, ResultUnion::Failure(_)));
        assert_eq!(counts(), (asked + 1, ran_again + 2));
        // The first pass of a caller's sequence asks nothing. Its second pass asks.
        let missing = made.resolver.with_miss_recheck(
            |resolver, how| resolver.resolve_and_auto_install_as(&dir, nowhere, stmt, allowed, how),
            |found| matches!(found, ResultUnion::NotFound),
        );
        assert!(matches!(missing, ResultUnion::Failure(_)));
        assert_eq!(counts(), (asked + 2, ran_again + 3));
        // The first run of a build checks at the generation of the build, and asks nothing either.
        made.resolver.generation = next_generation();
        let missing = made
            .resolver
            .resolve_and_auto_install(&dir, nowhere, stmt, allowed);
        made.resolver.generation = 0;
        assert!(matches!(missing, ResultUnion::Failure(_)));
        assert_eq!(counts(), (asked + 3, ran_again + 4));
        // No run follows a miss of a resolver that trusts cached misses: its one run asks.
        let mut trusting = resolver();
        trusting.trust_cached_misses();
        trusting.env_loader = made.resolver.env_loader;
        let missing = trusting.resolve_and_auto_install(&dir, nowhere, stmt, allowed);
        assert!(matches!(missing, ResultUnion::Failure(_)));
        assert_eq!(counts(), (asked + 4, ran_again + 4));
    });
}

/// As a caller does with lookups of its own: from one directory, then from the next. With what it found, the passes that ran.
fn from_either(
    resolver: &mut Resolver<'static>,
    dirs: [&[u8]; 2],
    specifier: &'static [u8],
) -> (Option<Vec<u8>>, u32) {
    let stmt = ast::ImportKind::Stmt;
    let mut passes = 0;
    let found = resolver.with_miss_recheck(
        |resolver, how| {
            passes += 1;
            let first = resolver.resolve_as(dirs[0], specifier, stmt, how);
            if first.is_ok() {
                return first;
            }
            resolver.resolve_as(dirs[1], specifier, stmt, how)
        },
        |found| found.is_err(),
    );
    let path = found.ok().map(|found| {
        let path = found.path_const().expect("a path");
        path.text.to_vec()
    });
    (path, passes)
}

#[test]
fn the_second_pass_of_a_sequence_finds_what_was_made_after_the_miss() {
    with_project("sequence", |made| {
        made.mkdir("src");
        made.mkdir("lib");
        let dirs = [made.path("src"), made.path("lib")].map(|dir| [&dir[..], b"/"].concat());
        let dirs = [&dirs[0][..], &dirs[1][..]];
        let mut trusting = resolver();
        trusting.trust_cached_misses();
        let ran_again = || counters().0;
        let before = ran_again();
        assert_eq!(from_either(&mut trusting, dirs, b"./late.js"), (None, 1));
        assert_eq!(ran_again(), before);
        assert_eq!(
            from_either(&mut made.resolver, dirs, b"./late.js"),
            (None, 2)
        );
        // The second pass counts as one lookup run again, and both of its lookups asked at its one generation.
        let after_the_miss = ran_again();
        assert_eq!(after_the_miss, before + 1);
        let asked = dirs.map(|dir| listing(dir, 0).expect("a directory").stamp);
        assert!(asked[0] != 0 && asked[0] == asked[1]);
        made.write("lib/late.js", "");
        let late = Some(made.path("lib/late.js"));
        // The caches say that it is not there: a resolver that trusts them runs one pass.
        assert_eq!(from_either(&mut trusting, dirs, b"./late.js"), (None, 1));
        assert_eq!(ran_again(), after_the_miss);
        assert_eq!(
            from_either(&mut made.resolver, dirs, b"./late.js"),
            (late.clone(), 2)
        );
        assert_eq!(ran_again(), after_the_miss + 1);
        // What the pass found is made ready at its generation too: the slot of the directory has the stamp of its listing.
        let lib = made.info(0, "lib").expect("a directory");
        assert_eq!(
            Some(stamp_of(lib)),
            listing(dirs[1], 0).map(|listing| listing.stamp)
        );
        // The caches have it now: one pass for either resolver.
        assert_eq!(
            from_either(&mut made.resolver, dirs, b"./late.js"),
            (late.clone(), 1)
        );
        assert_eq!(from_either(&mut trusting, dirs, b"./late.js"), (late, 1));
    });
}

/// As two threads do with one lookup each: `first` misses on what the caches hold, `second` then misses, runs again and finds the module, and `first` runs again last. Its second run is at `generation`, or at one drawn after `second` is done.
fn found_by_each_in_turn(
    [first, second]: [&mut Resolver<'static>; 2],
    (dir, specifier): (&[u8], &[u8]),
    generation: Option<Generation>,
) -> [bool; 3] {
    let kind = ast::ImportKind::Require;
    let missed = first.resolve_as(dir, specifier, kind, AfterMiss::TrustCache);
    let by_second = second.resolve(dir, specifier, kind).is_ok();
    let slots = DirInfo::slots_used();
    let again = AfterMiss::CheckedPass(generation.unwrap_or_else(next_generation));
    let by_first = first.resolve_as(dir, specifier, kind, again).is_ok();
    [
        missed.is_err(),
        by_second && by_first,
        DirInfo::slots_used() == slots,
    ]
}

#[test]
fn a_lookup_that_runs_again_after_another_one_did_finds_the_module_and_fills_no_slot() {
    with_project("in-turn", |made| {
        let mut other = resolver();
        let kind = ast::ImportKind::Require;
        let top = made.path("");
        let dir = |below: &str| [&top[..], b"/", below.as_bytes(), b"/"].concat();
        let all = [true; 3];

        // An alias that the tsconfig.json next to the importer gets.
        made.write("ts/real.cjs", "");
        let paths =
            |names: &str| format!(r#"{{ "compilerOptions": {{ "paths": {{ {names} }} }} }}"#);
        made.write("ts/tsconfig.json", &paths(r#""other": ["./real.cjs"]"#));
        let ask = (&dir("ts")[..], &b"late-alias"[..]);
        assert!(made.resolver.resolve(ask.0, ask.1, kind).is_err());
        let both = r#""other": ["./real.cjs"], "late-alias": ["./real.cjs"]"#;
        made.write("ts/tsconfig.json", &paths(both));
        let in_turn = found_by_each_in_turn([&mut other, &mut made.resolver], ask, None);
        assert_eq!(in_turn, all);

        // The "imports" that the package.json next to the importer gets. The first lookup drew its generation before the other one ran.
        made.write("imports/real.cjs", "");
        made.write("imports/package.json", r#"{ "name": "p" }"#);
        let ask = (&dir("imports")[..], &b"#late"[..]);
        assert!(made.resolver.resolve(ask.0, ask.1, kind).is_err());
        let with_imports = r##"{ "name": "p", "imports": { "#late": "./real.cjs" } }"##;
        made.write("imports/package.json", with_imports);
        let older = Some(next_generation());
        let in_turn = found_by_each_in_turn([&mut other, &mut made.resolver], ask, older);
        assert_eq!(in_turn, all);

        // The package.json of a package, read while it was half written.
        made.write("half/node_modules/pkg/real.cjs", "");
        let manifest = "half/node_modules/pkg/package.json";
        made.write(manifest, r#"{ "name": "pkg", "exports": "#);
        let ask = (&dir("half")[..], &b"pkg"[..]);
        assert!(made.resolver.resolve(ask.0, ask.1, kind).is_err());
        made.write(manifest, r#"{ "name": "pkg", "exports": "./real.cjs" }"#);
        let in_turn = found_by_each_in_turn([&mut other, &mut made.resolver], ask, None);
        assert_eq!(in_turn, all);

        // "imports" above the importer, which a lookup from there has read again: the slot of the importer's directory still names the old slot above it.
        made.mkdir("above/src");
        made.write("above/real.cjs", "");
        let imports = |names: &str| format!(r#"{{ "name": "p", "imports": {{ {names} }} }}"#);
        made.write(
            "above/package.json",
            &imports(r##""#other": "./real.cjs""##),
        );
        let ask = (&dir("above/src")[..], &b"#late"[..]);
        assert!(made.resolver.resolve(ask.0, ask.1, kind).is_err());
        let both = r##""#other": "./real.cjs", "#late": "./real.cjs""##;
        made.write("above/package.json", &imports(both));
        assert!(made.resolver.resolve(&dir("above"), ask.1, kind).is_ok());
        let older = Some(next_generation());
        let in_turn = found_by_each_in_turn([&mut other, &mut made.resolver], ask, older);
        assert_eq!(in_turn, all);
    });
}

#[test]
fn a_resolver_derived_while_a_sequence_runs_gets_what_its_parent_was_built_with() {
    with_project("derived", |made| {
        let derive = |from: &Resolver<'_>| -> Resolver<'static> {
            // SAFETY: `from` has no module graph and no loader of the environment.
            unsafe { Resolver::for_worker(from, from.log, options()) }
        };
        let of_build = next_generation();
        made.resolver.generation = of_build;
        let dir = [&made.path("")[..], b"/"].concat();
        // Both passes of a sequence that misses: no field of the resolver says which pass runs.
        let mut derived = Vec::new();
        let found = made.resolver.with_miss_recheck(
            |resolver, how| {
                let child = derive(&*resolver);
                derived.push((child.trusts_cached_misses, child.generation));
                resolver.resolve_as(&dir, b"./nothing.js", ast::ImportKind::Stmt, how)
            },
            |found| found.is_err(),
        );
        assert!(found.is_err());
        assert_eq!(derived, [(false, of_build); 2]);
        made.resolver.trust_cached_misses();
        let child = derive(&made.resolver);
        assert!(child.trusts_cached_misses && child.generation == of_build);
    });
}

/// The superuser passes every permission check. Until this is dropped the thread owns no file.
#[cfg(target_os = "linux")]
struct WithoutPrivileges(libc::c_int);

#[cfg(target_os = "linux")]
impl WithoutPrivileges {
    fn new() -> WithoutPrivileges {
        // SAFETY: it changes the user that the file system sees, for this thread alone.
        WithoutPrivileges(unsafe { libc::setfsuid(65534) })
    }
}

#[cfg(target_os = "linux")]
impl Drop for WithoutPrivileges {
    fn drop(&mut self) {
        // SAFETY: as in `new`.
        unsafe { libc::setfsuid(self.0 as libc::uid_t) };
    }
}

#[test]
#[cfg(target_os = "linux")]
fn a_directory_that_can_be_entered_and_not_listed_keeps_its_slot() {
    with_project("not-listed", |made| {
        made.write("locked/node_modules/late/index.js", "");
        made.mkdir("locked/app");
        made.set_mode("", 0o755);
        made.set_mode("locked/app", 0o755);
        made.set_mode("locked", 0o311);
        let (locked_dir, app_dir) = (made.os_path("locked"), made.os_path("locked/app"));
        // The project is removed when the test ends, also one that failed.
        scopeguard::defer! {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&locked_dir, std::fs::Permissions::from_mode(0o755));
        }
        let _unprivileged = WithoutPrivileges::new();
        // A thread that cannot give up its privileges lists the directory, and one that has none may not reach it.
        if std::fs::read_dir(&locked_dir).is_ok() || std::fs::metadata(&app_dir).is_err() {
            return;
        }
        let app = made.info(0, "locked/app").expect("a directory");
        let locked = app.get_parent().expect("the directory above");
        assert!(!locked.has_node_modules());
        let slots = DirInfo::slots_used();
        let (_, new_listings, _) = counters();
        for _ in 0..5 {
            let again = made.checked_info("locked/app");
            assert_eq!(
                (slot(again), again.get_parent().map(slot)),
                (slot(app), Some(slot(locked)))
            );
        }
        assert_eq!((DirInfo::slots_used(), counters().1), (slots, new_listings));
    });
}

#[test]
#[cfg(target_os = "linux")]
fn a_lookup_that_runs_again_enters_a_directory_that_could_not_be_listed_by_key() {
    with_project("not-listed-by-key", |made| {
        made.write("node_modules/dep/index.js", "");
        made.mkdir("locked/app");
        for open_to_all in ["", "node_modules", "node_modules/dep", "locked/app"] {
            made.set_mode(open_to_all, 0o755);
        }
        made.set_mode("locked", 0o311);
        let (locked_dir, app_dir) = (made.os_path("locked"), made.os_path("locked/app"));
        // The project is removed when the test ends, also one that failed.
        scopeguard::defer! {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&locked_dir, std::fs::Permissions::from_mode(0o755));
        }
        let _unprivileged = WithoutPrivileges::new();
        // A thread that cannot give up its privileges lists the directory, and one that has none may not reach it.
        if std::fs::read_dir(&locked_dir).is_ok() || std::fs::metadata(&app_dir).is_err() {
            return;
        }
        let top = [&made.path("")[..], b"/"].concat();
        let stmt = ast::ImportKind::Stmt;
        // A file directly in the directory is looked up in the listing of the directory: that it cannot be listed is cached.
        assert!(made.resolver.resolve(&top, b"./locked/x.js", stmt).is_err());
        let not_allowed = crate::Error::Sys(bun_errno::SystemErrno::EACCES);
        assert_eq!(listing_error(&made.path("locked"), 0), Some(not_allowed));
        let app = [&made.path("locked/app")[..], b"/"].concat();
        assert!(made.resolver.resolve(&app, b"dep/index.js", stmt).is_ok());
        let (below, locked) = (made.info(0, "locked/app"), made.info(0, "locked"));
        assert!(locked.is_some());
        assert_eq!(
            below.and_then(|below| below.get_parent()).map(slot),
            locked.map(slot)
        );
        let slots = DirInfo::slots_used();
        for _ in 0..3 {
            assert!(made.resolver.resolve(&app, b"dep/index.js", stmt).is_ok());
        }
        assert_eq!(DirInfo::slots_used(), slots);
    });
}

#[test]
fn the_root_of_the_file_system_has_no_parent() {
    with_project("root", |made| {
        // Asked for by its own path, and not reached as the directory above another one.
        made.resolver.bust_dir_cache(b"/");
        let root = made.info_at(0, b"/").expect("a directory");
        assert!(root.get_parent().is_none());
        let checked = made.info_at(next_generation(), b"/").expect("a directory");
        assert!(slot(checked) == slot(root) && checked.get_parent().is_none());
        // The levels above a directory pointed at the dropped slot: they are linked to the new one.
        let below = made.checked_info("");
        let mut level = below;
        while let Some(parent) = level.get_parent() {
            level = parent;
        }
        assert_eq!(slot(level), slot(root));
    });
}

#[test]
fn a_derived_resolver_inherits_the_miss_policy() {
    let mut parent = resolver();
    let derive = |from: &Resolver<'_>| -> Resolver<'static> {
        // SAFETY: `from` has no module graph and no loader of the environment.
        unsafe { Resolver::for_worker(from, from.log, options()) }
    };
    assert!(derive(&parent).reruns_after_miss(AfterMiss::Recheck));
    assert!(!derive(&parent).reruns_after_miss(AfterMiss::TrustCache));
    parent.trust_cached_misses();
    let child = derive(&parent);
    assert!(!child.reruns_after_miss(AfterMiss::Recheck));
    assert!(!derive(&child).reruns_after_miss(AfterMiss::Recheck));
}

#[test]
fn a_sequence_that_misses_runs_once_more_unless_its_resolver_trusts_cached_misses() {
    // What each pass is told to do after a miss, for a sequence that finds its module in the pass `found_in`.
    let passes_of = |resolver: &mut Resolver<'_>, found_in: usize| {
        let mut passes: Vec<AfterMiss> = Vec::new();
        let found = resolver.with_miss_recheck(
            |_, how| {
                passes.push(how);
                passes.len() == found_in
            },
            |found| !*found,
        );
        (passes, found)
    };
    let once = vec![AfterMiss::TrustCache];
    let mut resolver = resolver();
    let ran_again = || counters().0;
    let before = ran_again();
    assert!(passes_of(&mut resolver, 1) == (once.clone(), true));
    assert_eq!(ran_again(), before);
    // The second pass gets one generation, newer than each one before it, and counts as one lookup run again.
    let mut newest = next_generation();
    for (found_in, finds) in [(2, true), (3, false)] {
        let (passes, found) = passes_of(&mut resolver, found_in);
        let [AfterMiss::TrustCache, AfterMiss::CheckedPass(asked)] = passes[..] else {
            panic!("a pass that trusts the caches, then one that checks");
        };
        assert!(found == finds && asked > newest && asked < next_generation());
        assert!(!resolver.reruns_after_miss(AfterMiss::CheckedPass(asked)));
        newest = asked;
    }
    assert_eq!(ran_again(), before + 2);
    resolver.trust_cached_misses();
    assert!(passes_of(&mut resolver, 1) == (once.clone(), true));
    assert!(passes_of(&mut resolver, 2) == (once, false));
    assert_eq!(ran_again(), before + 2);
}

#[test]
fn a_sequence_that_misses_in_both_passes_logs_each_message_once() {
    let mut resolver = resolver();
    let mut pass = 0;
    resolver.with_miss_recheck(
        |resolver, _| {
            pass += 1;
            let log = resolver.log_mut();
            log.add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("in both passes"));
            if pass == 1 {
                log.add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("in the first pass"));
            }
        },
        |_| true,
    );
    let log = resolver.log_ref();
    assert_eq!((log.msgs.len(), log.errors, pass), (2, 2, 2));
}
