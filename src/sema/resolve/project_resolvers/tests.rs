use super::*;
use crate::resolve::code::memory_host::MemoryHost;
use std::sync::Arc;

fn two_projects() -> MemoryHost {
    MemoryHost::new(&[
        ("/p/app/x.ts", ""),
        ("/p/lib/y.ts", ""),
        ("/p/lib/src/a.ts", ""),
        ("/p/app/src/a.ts", ""),
        ("/p/other/src/a.ts", ""),
    ])
}

fn project(directory: &[u8], paths: Paths) -> Options {
    Options {
        base_dir: directory.to_vec(),
        config_path: inside(directory, b"tsconfig.json"),
        has_config_file: true,
        paths: Arc::new(paths),
        ..Default::default()
    }
}

fn project_with_referenced_output(directory: &[u8]) -> Options {
    Options {
        referenced_outputs: vec![(b"/p/built/dist".to_vec(), b"/p/built/src".to_vec())],
        ..project(directory, Paths::new())
    }
}

fn source_alias() -> Paths {
    vec![(b"@/*".to_vec(), vec![b"./src/*".to_vec()])]
}

#[track_caller]
fn assert_resolves(resolver: &Resolver<'_>, spec: &str, from: &str, expected: Option<&str>) {
    let (spec, from) = (spec.as_bytes(), from.as_bytes());
    let resolved = resolver.resolve_module_name(spec, from, ResolutionMode::None);
    let found = resolved.map(|module| bstr::BStr::new(module.file_name));
    assert_eq!(found, expected.map(bstr::BStr::new));
}

#[test]
#[cfg_attr(miri, ignore)]
fn project_resolver_uses_own_paths() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", Paths::new());
    let lib = project(b"/p/lib", source_alias());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let of_lib = resolvers.resolver_for(&program, &lib);
    assert!(std::ptr::eq(of_lib.options(), &lib));
    assert_resolves(&program, "@/a", "/p/lib/y.ts", None);
    assert_resolves(of_lib, "@/a", "/p/lib/y.ts", Some("/p/lib/src/a.ts"));
}

#[test]
#[cfg_attr(miri, ignore)]
fn one_resolver_per_options() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", Paths::new());
    let lib = project(b"/p/lib", source_alias());
    let other = project(b"/p/other", Paths::new());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let first = resolvers.resolver_for(&program, &lib);
    let again = resolvers.resolver_for(&program, &lib);
    let second = resolvers.resolver_for(&program, &other);
    assert!(std::ptr::eq(first, again));
    assert!(!std::ptr::eq(first, second));
    assert!(!std::ptr::eq(first, &program));
    assert_eq!((first.redirect, second.redirect), (1, 2));
    assert_eq!(resolvers.0.index_by_key.lock().len(), 2);
}

#[test]
#[cfg_attr(miri, ignore)]
fn equal_options_at_other_address_get_other_resolver() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", Paths::new());
    let lib = project(b"/p/lib", source_alias());
    let copy = lib.clone();
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let of_lib = resolvers.resolver_for(&program, &lib);
    let of_copy = resolvers.resolver_for(&program, &copy);
    assert!(!std::ptr::eq(of_lib, of_copy));
}

#[test]
#[cfg_attr(miri, ignore)]
fn program_options_return_program() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", Paths::new());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    assert!(std::ptr::eq(
        resolvers.resolver_for(&program, &app),
        &program
    ));
    assert!(resolvers.0.index_by_key.lock().is_empty());
}

#[test]
#[cfg_attr(miri, ignore)]
fn redirect_numbers_follow_referenced_projects() {
    let (session, host) = (Session::new(), two_projects());
    let app = Options {
        referenced_options: vec![
            project(b"/p/first", Paths::new()),
            project(b"/p/second", Paths::new()),
        ],
        ..project(b"/p/app", Paths::new())
    };
    let lib = project(b"/p/lib", Paths::new());
    let other = project(b"/p/other", Paths::new());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    assert_eq!(resolvers.resolver_for(&program, &lib).redirect, 3);
    assert_eq!(resolvers.resolver_for(&program, &other).redirect, 4);
}

#[test]
#[cfg_attr(miri, ignore)]
fn racing_threads_get_one_resolver() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", Paths::new());
    let lib = project(b"/p/lib", source_alias());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let barrier = std::sync::Barrier::new(8);
    let mut addresses: Vec<usize> = std::thread::scope(|scope| {
        let spawned: Vec<_> = (0..8)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    std::ptr::from_ref(resolvers.resolver_for(&program, &lib)).addr()
                })
            })
            .collect();
        spawned.into_iter().map(|it| it.join().unwrap()).collect()
    });
    addresses.dedup();
    assert_eq!(addresses.len(), 1);
    assert_eq!(resolvers.0.index_by_key.lock().len(), 1);
}

#[test]
#[cfg_attr(miri, ignore)]
fn shared_memo_separates_program_and_project() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", source_alias());
    let lib = project(b"/p/lib", source_alias());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let of_lib = resolvers.resolver_for(&program, &lib);
    assert!(Arc::ptr_eq(&program.caches, &of_lib.caches));
    for _ in 0..2 {
        assert_resolves(&program, "@/a", "/p/lib/y.ts", Some("/p/app/src/a.ts"));
        assert_resolves(of_lib, "@/a", "/p/lib/y.ts", Some("/p/lib/src/a.ts"));
        assert_resolves(of_lib, "@/a", "/p/app/x.ts", Some("/p/lib/src/a.ts"));
        assert_resolves(&program, "@/a", "/p/app/x.ts", Some("/p/app/src/a.ts"));
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn shared_memo_separates_two_projects() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", Paths::new());
    let lib = project(b"/p/lib", source_alias());
    let other = project(b"/p/other", source_alias());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let of_lib = resolvers.resolver_for(&program, &lib);
    let of_other = resolvers.resolver_for(&program, &other);
    assert!(Arc::ptr_eq(&of_lib.caches, &of_other.caches));
    for _ in 0..2 {
        assert_resolves(of_lib, "@/a", "/p/app/x.ts", Some("/p/lib/src/a.ts"));
        assert_resolves(of_other, "@/a", "/p/app/x.ts", Some("/p/other/src/a.ts"));
        assert_resolves(&program, "@/a", "/p/app/x.ts", None);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn shared_caches_read_manifest_once() {
    let manifest = "/p/node_modules/pkg/package.json";
    let files = [
        (manifest, r#"{"name": "pkg", "version": "1.0.0"}"#),
        ("/p/node_modules/pkg/index.d.ts", ""),
    ];
    let (session, host) = (Session::new(), MemoryHost::new(&files));
    let app = project(b"/p/app", Paths::new());
    let lib = project(b"/p/lib", Paths::new());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let declaration_file = Some("/p/node_modules/pkg/index.d.ts");
    assert_resolves(&program, "pkg", "/p/app/x.ts", declaration_file);
    assert_eq!(host.reads(manifest), 1);
    let of_lib = resolvers.resolver_for(&program, &lib);
    assert_resolves(of_lib, "pkg", "/p/lib/y.ts", declaration_file);
    assert_eq!(host.reads(manifest), 1);
}

#[test]
#[cfg_attr(miri, ignore)]
fn separate_caches_read_manifest_again() {
    let manifest = "/p/node_modules/pkg/package.json";
    let files = [
        (manifest, r#"{"name": "pkg", "version": "1.0.0"}"#),
        ("/p/node_modules/pkg/index.d.ts", ""),
    ];
    let (session, host) = (Session::new(), MemoryHost::new(&files));
    let app = project(b"/p/app", Paths::new());
    let other = project_with_referenced_output(b"/p/other");
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let declaration_file = Some("/p/node_modules/pkg/index.d.ts");
    assert_resolves(&program, "pkg", "/p/app/x.ts", declaration_file);
    let of_other = resolvers.resolver_for(&program, &other);
    assert_resolves(of_other, "pkg", "/p/other/z.ts", declaration_file);
    assert_eq!(host.reads(manifest), 2);
}

#[test]
#[cfg_attr(miri, ignore)]
fn project_referenced_outputs_prevent_cache_sharing() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", Paths::new());
    let lib = project(b"/p/lib", Paths::new());
    let other = project_with_referenced_output(b"/p/other");
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let shared = resolvers.resolver_for(&program, &lib);
    let separate = resolvers.resolver_for(&program, &other);
    assert!(Arc::ptr_eq(&program.caches, &shared.caches));
    assert!(!Arc::ptr_eq(&program.caches, &separate.caches));
}

#[test]
#[cfg_attr(miri, ignore)]
fn program_referenced_outputs_prevent_cache_sharing() {
    let (session, host) = (Session::new(), two_projects());
    let app = project_with_referenced_output(b"/p/app");
    let lib = project(b"/p/lib", Paths::new());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let of_lib = resolvers.resolver_for(&program, &lib);
    assert!(!Arc::ptr_eq(&program.caches, &of_lib.caches));
    assert!(program.is_dir(b"/p/built/dist"));
    assert!(!of_lib.is_dir(b"/p/built/dist"));
}

#[test]
#[cfg_attr(miri, ignore)]
fn project_links_reach_program_when_added() {
    let files = [
        ("/p/app/x.ts", ""),
        ("/p/lib/y.ts", ""),
        ("/p/store/pkg/index.d.ts", ""),
    ];
    let host = MemoryHost::new(&files).link("/p/lib/node_modules/pkg", "/p/store/pkg");
    let session = Session::new();
    let app = project(b"/p/app", Paths::new());
    let lib = project(b"/p/lib", Paths::new());
    let program = Resolver::new(&session, &host, &app);
    let resolvers = ProjectResolvers::new();
    let of_lib = resolvers.resolver_for(&program, &lib);
    assert_resolves(
        of_lib,
        "pkg",
        "/p/lib/y.ts",
        Some("/p/store/pkg/index.d.ts"),
    );
    assert!(program.links.lock().is_empty());
    assert!(program.linked_directories(std::iter::empty()).is_empty());

    resolvers.add_links_to(&program);
    let directories = program.linked_directories(std::iter::empty());
    let expected = (
        b"/p/store/pkg".to_vec(),
        b"/p/lib/node_modules/pkg".to_vec(),
    );
    assert_eq!(directories, [expected]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn no_project_adds_no_link() {
    let (session, host) = (Session::new(), two_projects());
    let app = project(b"/p/app", Paths::new());
    let program = Resolver::new(&session, &host, &app);
    ProjectResolvers::default().add_links_to(&program);
    assert!(program.links.lock().is_empty());
}
