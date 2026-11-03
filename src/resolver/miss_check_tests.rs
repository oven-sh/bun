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

/// `bun_install` defines it for Bun. No lookup of these tests installs a package.
#[unsafe(no_mangle)]
fn __bun_resolver_init_package_manager(
    _log: NonNull<bun_ast::Log>,
    _install: Option<NonNull<bun_options_types::schema::api::BunInstall>>,
    _env: NonNull<bun_dotenv::Loader>,
    _prefer_offline: bool,
    _importer_dir: &[u8],
) -> crate::CrateResult<NonNull<dyn AutoInstaller>> {
    Err(crate::Error::ModuleNotFound)
}

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

fn resolver() -> Resolver<'static> {
    static FILE_SYSTEM: std::sync::Once = std::sync::Once::new();
    FILE_SYSTEM.call_once(|| {
        Fs::FileSystem::init(None).expect("the working directory");
    });
    let log = NonNull::from(Box::leak(Box::new(bun_ast::Log::init())));
    let file_system = Fs::FileSystem::init(None).expect("set above");
    Resolver::init1(log, file_system, options())
}

fn read(resolver: &mut Resolver<'_>, dir: &[u8]) -> DirInfoRef {
    resolver
        .read_dir_info(dir)
        .expect("readable")
        .expect("a directory")
}

#[test]
fn the_root_of_the_file_system_has_no_parent() {
    let mut resolver = resolver();
    // Asked for by its own path, and not reached as the directory above another one.
    resolver.bust_dir_cache(b"/");
    let slot = read(&mut resolver, b"/");
    assert!(slot.get_parent().is_none());
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
    let again = vec![AfterMiss::TrustCache, AfterMiss::Recheck];
    let mut resolver = resolver();
    assert!(passes_of(&mut resolver, 1) == (once.clone(), true));
    assert!(passes_of(&mut resolver, 2) == (again.clone(), true));
    assert!(passes_of(&mut resolver, 3) == (again, false));
    resolver.trust_cached_misses();
    assert!(passes_of(&mut resolver, 1) == (once.clone(), true));
    assert!(passes_of(&mut resolver, 2) == (once, false));
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
