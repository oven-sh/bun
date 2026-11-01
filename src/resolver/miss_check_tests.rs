//! The check after a miss (`Resolver::bust_touched_dirs`), with records built by hand and no second thread.

#![allow(clippy::disallowed_methods)]

use super::*;
use std::os::unix::ffi::OsStrExt as _;

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

/// A new directory with `below` in it. Removed when the test ends.
struct Directories {
    top: Vec<u8>,
    below: Vec<u8>,
}

impl Drop for Directories {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(std::ffi::OsStr::from_bytes(&self.top));
    }
}

fn directories(name: &str, child: &str) -> Directories {
    let unique_name = format!("bun-resolver-miss-check-{}-{name}", std::process::id());
    let top = std::env::temp_dir().join(unique_name);
    let _ = std::fs::remove_dir_all(&top);
    std::fs::create_dir_all(top.join(child)).expect("directories");
    let top = top.canonicalize().expect("directory");
    let below = top.join(child);
    Directories {
        top: top.as_os_str().as_bytes().to_vec(),
        below: below.as_os_str().as_bytes().to_vec(),
    }
}

fn read(resolver: &mut Resolver<'_>, dir: &[u8]) -> DirInfoRef {
    resolver
        .read_dir_info(dir)
        .expect("readable")
        .expect("a directory")
}

fn touched(slot: DirInfoRef, uses: &[SlotUse]) -> TouchedDirs {
    let mut touched = TouchedDirs::new();
    for &slot_use in uses {
        touched.push_slot(slot_use, slot);
    }
    touched
}

fn mapped(resolver: &mut Resolver<'_>, dir: &[u8]) -> Option<*const DirInfo::DirInfo> {
    resolver.cached_dir_info(dir).map(DirInfoRef::as_ptr)
}

#[test]
fn a_miss_that_read_the_mapped_slot_is_current() {
    let mut resolver = resolver();
    let made = directories("current", "src");
    let dir = made.below.clone();
    let slot = read(&mut resolver, &dir);
    let touched = touched(slot, &[SlotUse::Read, SlotUse::SearchLevel]);
    let mut reread = Vec::new();
    assert!(!resolver.bust_touched_dirs(&touched, Some(&dir[..]), &mut reread));
    assert_eq!(mapped(&mut resolver, &dir), Some(slot.as_ptr()));
    assert!(reread.is_empty());
}

#[test]
fn a_miss_that_read_a_dropped_slot_is_looked_up_again() {
    let mut resolver = resolver();
    let made = directories("dropped", "src");
    let dir = made.below.clone();
    let slot = read(&mut resolver, &dir);
    assert!(resolver.bust_dir_cache(&dir));
    let mut reread = Vec::new();
    for floor in [None, Some(&dir[..])] {
        let touched = touched(slot, &[SlotUse::Read]);
        assert!(resolver.bust_touched_dirs(&touched, floor, &mut reread));
    }
    assert_eq!(mapped(&mut resolver, &dir), None);
    assert!(reread.is_empty());
}

#[test]
fn a_miss_that_read_a_replaced_slot_is_looked_up_again_and_the_new_slot_stays() {
    let mut resolver = resolver();
    let made = directories("replaced", "src");
    let dir = made.below.clone();
    let old = read(&mut resolver, &dir);
    assert!(resolver.bust_dir_cache(&dir));
    let new = read(&mut resolver, &dir);
    assert_ne!(old.as_ptr(), new.as_ptr());
    let mut reread = Vec::new();
    let uses = [
        SlotUse::Read,
        SlotUse::SearchLevel,
        SlotUse::NoNodeModules,
        SlotUse::UnparsedPackageJson,
    ];
    for slot_use in uses {
        for floor in [None, Some(&dir[..])] {
            let touched = touched(old, &[slot_use]);
            assert!(resolver.bust_touched_dirs(&touched, floor, &mut reread));
            assert_eq!(mapped(&mut resolver, &dir), Some(new.as_ptr()));
        }
    }
    assert!(reread.is_empty());
}

#[test]
fn a_stale_slot_is_dropped_only_while_it_is_the_mapped_one() {
    let mut resolver = resolver();
    let made = directories("compare", "src");
    let dir = made.below.clone();
    let old = read(&mut resolver, &dir);
    assert!(resolver.bust_dir_cache(&dir));
    let new = read(&mut resolver, &dir);
    let verdict = |slot| Verdict {
        stale: false,
        new_dirs: Vec::new(),
        stale_listings: Vec::new(),
        stale_slots: vec![(&dir[..], slot)],
    };
    let mut reread = Vec::new();
    assert!(resolver.drop_stale_dirs(verdict(old), &[], &mut reread));
    assert_eq!(mapped(&mut resolver, &dir), Some(new.as_ptr()));
    assert!(reread.is_empty());
    assert!(!resolver.dir_cache_mut().remove_if(&dir, old.as_ptr()));

    assert!(resolver.drop_stale_dirs(verdict(new), &[], &mut reread));
    assert_eq!(mapped(&mut resolver, &dir), None);
    assert_eq!(reread, [bun_wyhash::hash(&dir)]);
}

#[test]
fn a_directory_that_this_lookup_dropped_before_is_not_dropped_again() {
    let mut resolver = resolver();
    let made = directories("reread", "src");
    let dir = made.below.clone();
    let slot = read(&mut resolver, &dir);
    let key = bun_wyhash::hash(&dir);
    let mut reread = vec![key];
    // It exists, and the replay found it out of the cache: another thread dropped it.
    let verdict = Verdict {
        stale: false,
        new_dirs: vec![&dir[..]],
        stale_listings: Vec::new(),
        stale_slots: Vec::new(),
    };
    assert!(resolver.drop_stale_dirs(verdict, &[], &mut reread));
    // Its listing differs from the disk: this lookup read it after its own drop.
    let verdict = Verdict {
        stale: false,
        new_dirs: Vec::new(),
        stale_listings: vec![&dir[..]],
        stale_slots: Vec::new(),
    };
    assert!(!resolver.drop_stale_dirs(verdict, &[], &mut reread));
    assert_eq!(mapped(&mut resolver, &dir), Some(slot.as_ptr()));
    assert_eq!(reread, [key]);
}

#[test]
fn directories_below_a_replaced_one_are_linked_again_in_one_check() {
    let mut resolver = resolver();
    let made = directories("relink", "a/b/c");
    let (top, deepest) = (made.top.clone(), made.below.clone());
    let slot = read(&mut resolver, &deepest);
    let mut chain = vec![slot];
    while chain.last().unwrap().abs_path.len() > top.len() + 1 {
        chain.push(chain.last().unwrap().get_parent().expect("a parent"));
    }
    let top_slot = *chain.last().unwrap();
    assert_eq!(
        strings::without_trailing_slash_windows_path(top_slot.abs_path),
        &top[..]
    );
    assert!(resolver.bust_dir_cache(&top));
    let new_top = read(&mut resolver, &top);

    // The walk read every level, the top one through the link of the level below it.
    let mut touched = TouchedDirs::new();
    for &level in &chain {
        touched.push_slot(SlotUse::SearchLevel, level);
    }
    let mut reread = Vec::new();
    assert!(resolver.bust_touched_dirs(&touched, None, &mut reread));
    assert_eq!(mapped(&mut resolver, &top), Some(new_top.as_ptr()));
    for level in &chain[..chain.len() - 1] {
        let dir = strings::without_trailing_slash_windows_path(level.abs_path);
        assert_eq!(mapped(&mut resolver, dir), None);
    }
    assert!(reread.is_empty());

    // Read again, the chain ends at the new slot, and the next check finds nothing.
    let slot = read(&mut resolver, &deepest);
    let mut touched = TouchedDirs::new();
    let mut level = Some(slot);
    while let Some(read) = level.filter(|read| read.abs_path.len() > top.len()) {
        touched.push_slot(SlotUse::SearchLevel, read);
        level = read.get_parent();
    }
    assert!(!resolver.bust_touched_dirs(&touched, None, &mut reread));
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
fn a_derived_resolver_inherits_the_miss_policy_but_not_a_call_in_progress() {
    let mut parent = resolver();
    let derive = |from: &Resolver<'_>| -> Resolver<'static> {
        // SAFETY: `from` has no module graph and no loader of the environment.
        unsafe { Resolver::for_worker(from, from.log, options()) }
    };
    assert!(derive(&parent).after_miss() == AfterMiss::Recheck);
    let scoped = parent.with_trusted_cache(|parent| derive(&*parent));
    assert!(scoped.after_miss() == AfterMiss::Recheck);
    parent.trust_cached_misses();
    let child = derive(&parent);
    assert!(child.after_miss() == AfterMiss::TrustCache);
    assert!(derive(&child).after_miss() == AfterMiss::TrustCache);
}
