use std::io::Write as _;

use bstr::BStr;
use bun_alloc::AllocError;
use bun_ast::{E, Expr, ExprData, Loc, StoreStr};
use bun_collections::VecExt as _;
use bun_core::{Global, Output, strings};
use bun_semver::{self as Semver, SlicedString};

use bun_install::dependency::{self, DependencyExt as _, TagExt as _};
use bun_install::lockfile::CatalogMap;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::{
    Dependency, INVALID_PACKAGE_ID, Lockfile, PackageID, PackageNameHash, resolution,
};
use bun_install_types::DependencyGroup;
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{join_abs_string_buf, platform};

use crate::bun_fs::FileSystem;

use super::add_remove_with_filter::{
    WorkspaceMembers, WorkspaceTarget, fetch_entry_root, load_workspace_members,
    local_relative_path, root_package_json_path,
};
use super::options::LogLevel;
use super::package_json_editor::{self as PackageJSONEditor, EditOptions};
use super::update_package_json_and_install::print_package_json_into_cache_entry;
use super::workspace_package_json_cache::MapEntry;
use super::{PackageManager, Subcommand, UpdateRequest};

type ExprDisabler = bun_ast::expr::Disabler;

type RootEntry = (Box<[u8]>, Box<[u8]>);

#[derive(Default)]
pub(crate) struct State {
    enabled: bool,
    auto_use: Vec<PackageNameHash>,
    adds: Vec<Add>,
    /// (name, text) of every entry the flag's catalog had before this command; filled by prepare() in --catalog mode.
    root_entries: Vec<RootEntry>,
    members: Vec<WorkspaceTarget>,
}

struct Add {
    name: Box<[u8]>,
    name_hash: PackageNameHash,
    group: Box<[u8]>,
    candidate: Candidate,
    outcome: Outcome,
    /// Labels of the targets that received this add; left out of the "also used by" list when an entry is replaced.
    targets: Vec<Box<[u8]>>,
}

enum Candidate {
    Explicit(Box<[u8]>),
    Existing(Box<[u8]>),
    Resolved(Box<[u8]>),
    Latest,
}

impl Candidate {
    fn literal(&self) -> &[u8] {
        match self {
            Candidate::Explicit(literal)
            | Candidate::Existing(literal)
            | Candidate::Resolved(literal) => &literal[..],
            Candidate::Latest => b"latest".as_slice(),
        }
    }
}

enum Outcome {
    Pending,
    Reused,
    Seeded,
    Moved { entry: Box<[u8]> },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Decision {
    Convert,
    Keep,
}

fn root_entry<'a>(root_entries: &'a [RootEntry], name: &[u8]) -> Option<&'a [u8]> {
    root_entries
        .iter()
        .find(|(entry_name, _)| **entry_name == *name)
        .map(|(_, text)| &text[..])
}

fn root_target() -> WorkspaceTarget {
    WorkspaceTarget {
        name: Box::default(),
        name_hash: None,
        package_json_path: root_package_json_path(),
    }
}

fn target_label(package_json: &Expr) -> Box<[u8]> {
    package_json
        .get(b"name")
        .and_then(|name| name.data.e_string())
        .map(|name| name.data.slice())
        .filter(|name| !name.is_empty())
        .unwrap_or(b"package.json".as_slice())
        .into()
}

fn note_follows(quiet: bool, name: &[u8], target: &[u8], entry: &[u8], declared: &[u8]) {
    if quiet {
        return;
    }
    bun_core::note!(
        "{} in {} now follows the catalog entry \"{}\" instead of \"{}\"",
        BStr::new(name),
        BStr::new(target),
        BStr::new(entry),
        BStr::new(declared),
    );
    Output::flush();
}

fn note_keeps(quiet: bool, name: &[u8], target: &[u8], declared: &[u8], entry: &[u8]) {
    if quiet {
        return;
    }
    bun_core::note!(
        "{} in {} keeps \"{}\" because the catalog entry is \"{}\"",
        BStr::new(name),
        BStr::new(target),
        BStr::new(declared),
        BStr::new(entry),
    );
    Output::flush();
}

fn note_replaced(name: &[u8], from: &[u8], to: &[u8], also_used_by: &[Box<[u8]>]) {
    let mut suffix: Vec<u8> = Vec::new();
    for (i, user) in also_used_by.iter().enumerate() {
        suffix.extend_from_slice(if i == 0 { b" (also used by " } else { b", " });
        suffix.extend_from_slice(user);
    }
    if !also_used_by.is_empty() {
        suffix.push(b')');
    }
    bun_core::note!(
        "catalog entry {} changed from \"{}\" to \"{}\"{}",
        BStr::new(name),
        BStr::new(from),
        BStr::new(to),
        BStr::new(&suffix),
    );
    Output::flush();
}

fn refuse_declared(literal: &[u8], target: &[u8], name: &[u8], flag: &[u8]) -> ! {
    let mut flag_spelling: Vec<u8> = b"--catalog".to_vec();
    if !flag.is_empty() {
        flag_spelling.push(b'=');
        flag_spelling.extend_from_slice(flag);
    }
    Output::flush();
    Output::err_generic(
        "--catalog cannot add \"{s}\": {s} already declares {s}\n  bun add {s}@{s} {s}",
        (
            BStr::new(literal),
            BStr::new(target),
            BStr::new(name),
            BStr::new(name),
            BStr::new(literal),
            BStr::new(&flag_spelling),
        ),
    );
    Global::crash();
}

fn estring(arena: &bun_alloc::Arena, bytes: &[u8]) -> Expr {
    Expr::allocate(
        arena,
        E::EString::init(arena.alloc_slice_copy(bytes)),
        Loc::EMPTY,
    )
}

fn reference_literal<'a>(arena: &'a bun_alloc::Arena, name: &[u8]) -> &'a [u8] {
    if name.is_empty() {
        return b"catalog:";
    }
    let mut literal = Vec::with_capacity(b"catalog:".len() + name.len());
    literal.extend_from_slice(b"catalog:");
    literal.extend_from_slice(name);
    arena.alloc_slice_copy(&literal)
}

fn set_property(mut object: Expr, arena: &bun_alloc::Arena, key: &[u8], value: Expr) {
    let obj = object
        .data
        .e_object_mut()
        .expect("infallible: caller checked object");
    match obj.as_property(key) {
        Some(q) => obj.properties.slice_mut()[q.i as usize].value = Some(value),
        None => obj.append_property(estring(arena, key), value),
    }
}

fn object_property(
    mut container: Expr,
    key: &[u8],
    create: Option<&bun_alloc::Arena>,
) -> Option<Expr> {
    let obj = container.data.e_object_mut()?;
    let existing = obj.as_property(key);
    if let Some(q) = &existing {
        if matches!(q.expr.data, ExprData::EObject(_)) {
            return Some(q.expr);
        }
    }
    let arena = create?;
    let created = Expr::allocate(arena, E::Object::default(), Loc::EMPTY);
    match existing {
        Some(q) => obj.properties.slice_mut()[q.i as usize].value = Some(created),
        None => obj.append_property(estring(arena, key), created),
    }
    Some(created)
}

fn has_catalogs(expr: &Expr) -> bool {
    expr.get(b"catalog").is_some() || expr.get(b"catalogs").is_some()
}

fn root_defines_catalogs(root: &Expr) -> bool {
    let Some(workspaces) = root.get(b"workspaces") else {
        return false;
    };
    has_catalogs(&workspaces) || has_catalogs(root)
}

fn catalogs_container(root: &Expr) -> Option<Expr> {
    let workspaces = root.get(b"workspaces")?;
    let workspaces_is_object = matches!(workspaces.data, ExprData::EObject(_));
    Some(if workspaces_is_object && has_catalogs(&workspaces) {
        workspaces
    } else if has_catalogs(root) || !workspaces_is_object {
        *root
    } else {
        workspaces
    })
}

fn default_group_objects(container: Expr, group: &[u8]) -> [Option<Expr>; 2] {
    let singular = object_property(container, b"catalog", None);
    let in_catalogs = object_property(container, b"catalogs", None)
        .and_then(|catalogs| object_property(catalogs, b"default", None));
    if group.is_empty() {
        [singular, in_catalogs]
    } else {
        [in_catalogs, singular]
    }
}

fn entries_object(
    root: &Expr,
    group: &[u8],
    dep: &[u8],
    create: Option<&bun_alloc::Arena>,
) -> Option<Expr> {
    let Some(container) = catalogs_container(root) else {
        if create.is_some() {
            Output::err_generic(
                "--catalog requires a \"workspaces\" field in the root package.json",
                (),
            );
            Global::crash();
        }
        return None;
    };

    if !CatalogMap::same_name(group, b"") {
        let catalogs = object_property(container, b"catalogs", create)?;
        return object_property(catalogs, group, create);
    }
    let candidates = default_group_objects(container, group);
    if let Some(defining) = candidates
        .iter()
        .flatten()
        .find(|object| object.as_property(dep).is_some())
    {
        return Some(*defining);
    }
    if let Some(existing) = candidates.iter().flatten().next() {
        return Some(*existing);
    }
    object_property(container, b"catalog", create)
}

fn request_literal(request: &UpdateRequest) -> &[u8] {
    request.version.literal.slice(request.version_buf())
}

/// `bun add foo` parses as a DistTag with an empty literal, so the tag alone cannot tell a bare name from `foo@latest`.
fn has_explicit_version(request: &UpdateRequest) -> bool {
    request.version.tag != dependency::Tag::Uninitialized && !request_literal(request).is_empty()
}

fn collect_root_entries(root: &Expr, group: &[u8], out: &mut Vec<RootEntry>) {
    let Some(container) = catalogs_container(root) else {
        return;
    };
    let objects: [Option<Expr>; 2] = if CatalogMap::same_name(group, b"") {
        default_group_objects(container, group)
    } else {
        [
            object_property(container, b"catalogs", None)
                .and_then(|catalogs| object_property(catalogs, group, None)),
            None,
        ]
    };
    for object in objects.iter().flatten() {
        let Some(obj) = object.data.e_object() else {
            continue;
        };
        for property in obj.properties.slice() {
            let (Some(key), Some(value)) = (
                property
                    .key
                    .as_ref()
                    .and_then(|k| k.as_utf8_string_literal()),
                property
                    .value
                    .as_ref()
                    .and_then(|v| v.as_utf8_string_literal()),
            ) else {
                continue;
            };
            out.push((key.into(), value.into()));
        }
    }
}

fn member_targets(ws: &WorkspaceMembers) -> Vec<WorkspaceTarget> {
    let top_level = strings::without_trailing_slash(FileSystem::instance().top_level_dir());
    let mut buf = path_buffer_pool::get();
    ws.members
        .keys()
        .iter()
        .zip(ws.members.values())
        .map(|(rel, entry)| {
            let rel: &[u8] = rel;
            WorkspaceTarget {
                name: entry.name.clone(),
                name_hash: Some(bun_semver::string::Builder::string_hash(&entry.name)),
                package_json_path: join_abs_string_buf::<platform::Auto>(
                    top_level,
                    &mut buf.0,
                    &[rel, b"package.json"],
                )
                .into(),
            }
        })
        .collect()
}

pub(crate) fn prepare(manager: &mut PackageManager, updates: &[UpdateRequest]) {
    if manager.subcommand != Subcommand::Add || manager.options.global || updates.is_empty() {
        return;
    }
    debug_assert!(
        !manager.catalog_add.enabled
            && manager.catalog_add.auto_use.is_empty()
            && manager.catalog_add.adds.is_empty()
            && manager.catalog_add.root_entries.is_empty()
            && manager.catalog_add.members.is_empty()
    );

    if let Some(group) = manager.options.add_catalog {
        for request in updates {
            if local_relative_path(request).is_some() {
                if request.is_aliased {
                    Output::err_generic(
                        "--catalog cannot add \"{s}@{s}\": a local path in the catalog would resolve from the workspace root, not from the package that added it",
                        (BStr::new(request.name), BStr::new(request_literal(request))),
                    );
                } else {
                    Output::err_generic(
                        "--catalog cannot add \"{s}\": a local path in the catalog would resolve from the workspace root, not from the package that added it",
                        (BStr::new(request_literal(request)),),
                    );
                }
                Global::crash();
            }
            if request.version.tag == dependency::Tag::Workspace {
                Output::err_generic(
                    "--catalog cannot add a workspace package, but got \"{s}@{s}\"",
                    (BStr::new(request.name), BStr::new(request_literal(request))),
                );
                Global::crash();
            }
        }
        let ws = load_workspace_members(manager);
        for request in updates.iter().filter(|request| request.is_aliased) {
            if *ws.root_name == *request.name {
                Output::err_generic(
                    "--catalog cannot add a workspace package, but \"{s}\" is the workspace root",
                    (BStr::new(request.name),),
                );
                Global::crash();
            }
            if let Some((rel, _)) = ws
                .members
                .keys()
                .iter()
                .zip(ws.members.values())
                .find(|(_, entry)| *entry.name == *request.name)
            {
                Output::err_generic(
                    "--catalog cannot add a workspace package, but \"{s}\" is the workspace at {s}",
                    (BStr::new(request.name), BStr::new(rel)),
                );
                Global::crash();
            }
        }
        let root = fetch_entry_root(manager, &root_target());
        if root.get(b"workspaces").is_none() {
            Output::err_generic(
                "--catalog requires a \"workspaces\" field in the root package.json",
                (),
            );
            Global::crash();
        }
        collect_root_entries(&root, group, &mut manager.catalog_add.root_entries);
        manager.catalog_add.members = member_targets(&ws);
        manager.catalog_add.enabled = true;
        return;
    }

    let root = fetch_entry_root(manager, &root_target());
    if !root_defines_catalogs(&root) {
        return;
    }
    manager.catalog_add.enabled = true;
    for request in updates.iter().filter(|request| request.is_aliased) {
        let Some(entries) = entries_object(&root, b"", request.name, None) else {
            continue;
        };
        let Some(q) = entries.as_property(request.name) else {
            continue;
        };
        let Some(entry_text) = q.expr.as_utf8_string_literal() else {
            continue;
        };
        if !has_explicit_version(request) || request_literal(request) == entry_text {
            manager.catalog_add.auto_use.push(request.name_hash);
        }
    }
}

fn existing_slot(package_json: &Expr, name: &[u8]) -> Option<StoreStr> {
    for group in DependencyGroup::FOUR {
        let Some(list) = package_json.get(group.prop) else {
            continue;
        };
        if !matches!(list.data, ExprData::EObject(_)) {
            continue;
        }
        let Some(q) = list.as_property(name) else {
            continue;
        };
        return q.expr.data.e_string().map(|s| s.data);
    }
    None
}

fn catalog_group_of(reference: &[u8]) -> &[u8] {
    strings::trim(&reference[b"catalog:".len()..], &strings::WHITESPACE_CHARS)
}

fn references_flag_group(slot: &[u8], flag: &[u8]) -> bool {
    dependency::Tag::infer(slot) == dependency::Tag::Catalog
        && CatalogMap::same_name(catalog_group_of(slot), flag)
}

fn find_add<'a>(
    adds: &'a mut [Add],
    name_hash: PackageNameHash,
    group: &[u8],
) -> Option<&'a mut Add> {
    adds.iter_mut()
        .find(|add| add.name_hash == name_hash && CatalogMap::same_name(&add.group, group))
}

fn catalogable_verbatim(literal: &[u8]) -> bool {
    match dependency::Tag::infer(literal) {
        dependency::Tag::Npm
        | dependency::Tag::DistTag
        | dependency::Tag::Git
        | dependency::Tag::Github => true,
        dependency::Tag::Tarball => Dependency::is_remote_tarball(literal),
        _ => false,
    }
}

fn record_add(
    state: &mut State,
    request: &UpdateRequest,
    group: &[u8],
    declared: Option<&[u8]>,
    target: &[u8],
    quiet: bool,
) -> Decision {
    let push = |adds: &mut Vec<Add>, candidate: Candidate| {
        adds.push(Add {
            name: request.name.into(),
            name_hash: request.name_hash,
            group: group.into(),
            candidate,
            outcome: Outcome::Pending,
            targets: Vec::new(),
        });
    };

    if has_explicit_version(request) {
        if find_add(&mut state.adds, request.name_hash, group).is_none() {
            push(
                &mut state.adds,
                Candidate::Explicit(request_literal(request).into()),
            );
        }
        let add =
            find_add(&mut state.adds, request.name_hash, group).expect("infallible: pushed above");
        add.targets.push(target.into());
        return Decision::Convert;
    }

    let declared = declared.filter(|literal| catalogable_verbatim(literal));
    let candidate = || match declared {
        Some(literal) => Candidate::Existing(literal.into()),
        None => Candidate::Latest,
    };

    if let (Some(declared), Some(entry)) = (declared, root_entry(&state.root_entries, request.name))
    {
        if declared != entry {
            note_follows(quiet, request.name, target, entry, declared);
        }
        if find_add(&mut state.adds, request.name_hash, group).is_none() {
            push(&mut state.adds, candidate());
        }
        return Decision::Convert;
    }

    let Some(add) = find_add(&mut state.adds, request.name_hash, group) else {
        push(&mut state.adds, candidate());
        return Decision::Convert;
    };
    match (&add.candidate, declared) {
        (Candidate::Latest, Some(_)) => {}
        (Candidate::Existing(seed), Some(declared)) => {
            if declared == &seed[..] {
                return Decision::Convert;
            }
            if exact_within(declared, seed) {
                note_follows(quiet, request.name, target, seed, declared);
                return Decision::Convert;
            }
            note_keeps(quiet, request.name, target, declared, seed);
            return Decision::Keep;
        }
        _ => return Decision::Convert,
    }
    add.candidate = candidate();
    Decision::Convert
}

fn drop_already_cataloged(
    updates: &mut &mut [UpdateRequest],
    package_json: &Expr,
    root_entries: &[RootEntry],
    flag: &[u8],
) {
    let mut i = 0;
    while i < updates.len() {
        let request = &updates[i];
        let already = !request.is_aliased
            && root_entries.iter().any(|(entry_name, text)| {
                &text[..] == request_literal(request)
                    && existing_slot(package_json, entry_name)
                        .is_some_and(|slot| references_flag_group(slot.slice(), flag))
            });
        if !already {
            i += 1;
            continue;
        }
        let last = updates.len() - 1;
        updates.swap(i, last);
        *updates = &mut core::mem::take(updates)[..last];
    }
}

fn keys_named(package_json: &Expr, dependency_list: &[u8], name: &[u8]) -> usize {
    package_json
        .get(dependency_list)
        .and_then(|list| list.data.e_object())
        .map_or(0, |list| {
            list.properties
                .slice()
                .iter()
                .filter(|property| {
                    property
                        .key
                        .as_ref()
                        .and_then(|key| key.data.e_string())
                        .is_some_and(|key| key.eql_bytes(name))
                })
                .count()
        })
}

/// Runs between resolution and `clean_with_logger`, whose hoist would otherwise silently collapse a nameless positional onto the target's own row for the same name, keeping whichever of the two it places first.
pub(crate) fn refuse_declared_positionals(manager: &PackageManager) {
    let Some(flag) = manager.options.add_catalog else {
        return;
    };
    if !manager.catalog_add.enabled {
        return;
    }
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let resolutions = lockfile.packages.items_resolution();
    let dependency_lists = lockfile.packages.items_dependencies();
    let dependencies = lockfile.buffers.dependencies.as_slice();

    for request in manager
        .update_requests
        .iter()
        .filter(|request| !request.is_aliased)
    {
        let literal = request_literal(request);
        for (pkg_id, list) in dependency_lists.iter().enumerate() {
            if !matches!(
                resolutions[pkg_id].tag,
                resolution::Tag::Root | resolution::Tag::Workspace
            ) {
                continue;
            }
            let deps: &[Dependency] = list.get(dependencies);
            let Some(row) = deps
                .iter()
                .find(|dep| dep.version.literal.slice(buf) == literal)
            else {
                continue;
            };
            let name = row.name.slice(buf);
            if name == literal {
                continue;
            }
            let declared_twice = deps
                .iter()
                .filter(|dep| dep.name_hash == row.name_hash && dep.behavior == row.behavior)
                .count()
                > 1;
            if declared_twice {
                let target = names[pkg_id].slice(buf);
                let target: &[u8] = if target.is_empty() {
                    b"package.json"
                } else {
                    target
                };
                refuse_declared(literal, target, name, flag);
            }
        }
    }
}

/// Positional without a name (`bun add <url> --catalog`): the entry is whatever plain add just wrote for the resolved name.
fn settle_resolved_positional(
    state: &mut State,
    request: &UpdateRequest,
    lockfile: &Lockfile,
    package_json: &Expr,
    dependency_list: &[u8],
    flag: &[u8],
    e_string: bun_ast::StoreRef<E::EString>,
    target: &[u8],
    quiet: bool,
) -> Decision {
    let name: &[u8] = request.get_resolved_name(lockfile);
    let name_hash = lockfile.packages.items_name_hash()[request.package_id as usize];
    let literal: &[u8] = e_string.data.slice();

    if keys_named(package_json, dependency_list, name) > 1 {
        refuse_declared(literal, target, name, flag);
    }

    let entry: &[u8] = match root_entry(&state.root_entries, name) {
        Some(entry) => entry,
        None => {
            let position = state
                .adds
                .iter()
                .position(|add| *add.name == *name && CatalogMap::same_name(&add.group, flag));
            match position {
                Some(i) => state.adds[i].candidate.literal(),
                None => {
                    state.adds.push(Add {
                        name: name.into(),
                        name_hash,
                        group: flag.into(),
                        candidate: Candidate::Resolved(literal.into()),
                        outcome: Outcome::Pending,
                        targets: Vec::new(),
                    });
                    literal
                }
            }
        }
    };

    if entry != literal {
        note_keeps(quiet, name, target, literal, entry);
        return Decision::Keep;
    }
    Decision::Convert
}

pub(crate) fn edit_target(
    manager: &mut PackageManager,
    updates: &mut &mut [UpdateRequest],
    package_json: &mut Expr,
    dependency_list: &[u8],
    options: EditOptions,
) -> Result<(), AllocError> {
    if !manager.catalog_add.enabled {
        PackageJSONEditor::edit(manager, updates, package_json, dependency_list, options)?;
        return Ok(());
    }
    let quiet = manager.options.log_level == LogLevel::Silent;
    let flag = manager.options.add_catalog;
    let label = target_label(package_json);

    if options.before_install {
        if let Some(flag) = flag {
            drop_already_cataloged(
                updates,
                package_json,
                &manager.catalog_add.root_entries,
                flag,
            );
        }
    }

    let captured: Vec<(PackageNameHash, StoreStr)> = updates
        .iter()
        .filter(|request| request.is_aliased)
        .filter_map(|request| {
            existing_slot(package_json, request.name).map(|slot| (request.name_hash, slot))
        })
        .collect();

    PackageJSONEditor::edit(manager, updates, package_json, dependency_list, options)?;

    let arena = &manager.ast_arena;
    let lockfile: &Lockfile = &manager.lockfile;
    let state = &mut manager.catalog_add;
    let flag_literal = flag.map(|name| StoreStr::new(reference_literal(arena, name)));

    for request in updates.iter_mut() {
        let Some(mut e_string) = request.e_string else {
            continue;
        };
        if !request.is_aliased {
            let Some(flag) = flag else {
                continue;
            };
            if options.before_install || request.package_id == INVALID_PACKAGE_ID {
                continue;
            }
            let decision = settle_resolved_positional(
                state,
                request,
                lockfile,
                package_json,
                dependency_list,
                flag,
                e_string,
                &label,
                quiet,
            );
            if decision == Decision::Convert {
                e_string.data = flag_literal.expect("infallible: flag is Some");
            }
            continue;
        }
        let existing = captured
            .iter()
            .find(|&&(name_hash, _)| name_hash == request.name_hash)
            .map(|&(_, slot)| slot);
        let existing_ref = existing
            .filter(|slot| dependency::Tag::infer(slot.slice()) == dependency::Tag::Catalog);

        let literal = if !options.before_install {
            let Some(reference) = existing_ref else {
                continue;
            };
            reference
        } else {
            match (existing_ref, flag) {
                (Some(reference), Some(_)) => {
                    record_add(
                        state,
                        request,
                        catalog_group_of(reference.slice()),
                        None,
                        &label,
                        quiet,
                    );
                    reference
                }
                (Some(reference), None) if !has_explicit_version(request) => reference,
                (None, Some(name)) => {
                    let declared = existing.map(|slot| slot.slice());
                    match record_add(state, request, name, declared, &label, quiet) {
                        Decision::Convert => flag_literal.expect("infallible: flag is Some"),
                        Decision::Keep => {
                            if let Some(slot) = existing {
                                e_string.data = slot;
                            }
                            request.e_string = None;
                            continue;
                        }
                    }
                }
                (None, None) if state.auto_use.contains(&request.name_hash) => {
                    StoreStr::new(b"catalog:")
                }
                _ => continue,
            }
        };
        // Same slot `edit` just wrote through (PackageJSONEditor.rs
        // `request.e_string` loop); the tree it points into is still live.
        e_string.data = literal;
    }
    Ok(())
}

fn exact_within(wanted: &[u8], entry: &[u8]) -> bool {
    let Some(version) = Semver::query::parse(wanted, SlicedString::init(wanted, wanted))
        .ok()
        .and_then(|group| group.get_exact_version())
    else {
        return false;
    };
    match Semver::query::parse(entry, SlicedString::init(entry, entry)) {
        Ok(group) => !group.is_empty() && group.satisfies(version, entry, wanted),
        Err(_) => false,
    }
}

fn alphabetize_appended(root: &Expr, adds: &[Add], appended: &[usize]) {
    for (n, &i) in appended.iter().enumerate() {
        let group = &adds[i].group;
        if appended[..n]
            .iter()
            .any(|&j| CatalogMap::same_name(&adds[j].group, group))
        {
            continue;
        }
        let mut entries = entries_object(root, group, &adds[i].name, None)
            .expect("infallible: created by the caller");
        let obj = entries
            .data
            .e_object_mut()
            .expect("infallible: entries_object returns objects");
        if obj.properties.len_u32() > 1 {
            obj.alphabetize_properties();
        }
    }
}

pub(crate) fn edit_root_before_install(
    manager: &mut PackageManager,
    root_package_json: &Expr,
) -> Result<(), AllocError> {
    let quiet = manager.options.log_level == LogLevel::Silent;
    let mut replaced: Vec<(usize, Box<[u8]>)> = Vec::new();
    {
        let _guard = ExprDisabler::scope();
        let arena = &manager.ast_arena;
        let adds = &mut manager.catalog_add.adds;

        let mut appended: Vec<usize> = Vec::new();
        for (i, add) in adds.iter_mut().enumerate() {
            if !matches!(add.outcome, Outcome::Pending) {
                continue;
            }
            debug_assert!(!matches!(add.candidate, Candidate::Resolved(_)));
            let entries = entries_object(root_package_json, &add.group, &add.name, Some(arena))
                .expect("infallible: created on demand");
            let existing: Option<Box<[u8]>> = entries
                .as_property(&add.name)
                .and_then(|q| q.expr.as_utf8_string_literal().map(Box::from));
            add.outcome = match (existing, &add.candidate) {
                (Some(entry), Candidate::Explicit(wanted)) if *entry == **wanted => Outcome::Reused,
                (Some(entry), Candidate::Explicit(wanted)) => {
                    set_property(entries, arena, &add.name, estring(arena, wanted));
                    if exact_within(wanted, &entry) {
                        Outcome::Moved { entry }
                    } else {
                        if !quiet {
                            replaced.push((i, entry));
                        }
                        Outcome::Seeded
                    }
                }
                (Some(_), Candidate::Existing(_) | Candidate::Resolved(_) | Candidate::Latest) => {
                    Outcome::Reused
                }
                (None, candidate) => {
                    set_property(
                        entries,
                        arena,
                        &add.name,
                        estring(arena, candidate.literal()),
                    );
                    appended.push(i);
                    Outcome::Seeded
                }
            };
        }

        alphabetize_appended(root_package_json, adds, &appended);
    }

    for (i, entry) in replaced {
        let also_used_by = other_users_of(manager, i, root_package_json);
        let add = &manager.catalog_add.adds[i];
        note_replaced(&add.name, &entry, add.candidate.literal(), &also_used_by);
    }
    Ok(())
}

/// Labels of the packages whose declaration follows the replaced entry but that were not targets of this add.
fn other_users_of(
    manager: &mut PackageManager,
    add_index: usize,
    root_package_json: &Expr,
) -> Vec<Box<[u8]>> {
    let (name, group, targets): (Box<[u8]>, Box<[u8]>, Vec<Box<[u8]>>) = {
        let add = &manager.catalog_add.adds[add_index];
        (add.name.clone(), add.group.clone(), add.targets.clone())
    };
    let follows = |package_json: &Expr| {
        existing_slot(package_json, &name)
            .is_some_and(|slot| references_flag_group(slot.slice(), &group))
    };
    let mut users: Vec<Box<[u8]>> = Vec::new();
    let root_label = target_label(root_package_json);
    if !targets.contains(&root_label) && follows(root_package_json) {
        users.push(root_label);
    }
    let members = core::mem::take(&mut manager.catalog_add.members);
    for member in &members {
        if targets.contains(&member.name) {
            continue;
        }
        let package_json = fetch_entry_root(manager, member);
        if follows(&package_json) {
            users.push(member.name.clone());
        }
    }
    manager.catalog_add.members = members;
    users
}

pub(crate) fn edit_root_entry_before_install(
    manager: &mut PackageManager,
    root_package_json_path: &[u8],
) -> Result<(), crate::Error> {
    if manager.catalog_add.adds.is_empty() {
        return Ok(());
    }
    let root = cached_root_entry(manager, root_package_json_path).0.root;
    edit_root_before_install(manager, &root)?;
    let (root_package_json, log) = cached_root_entry(manager, root_package_json_path);
    print_package_json_into_cache_entry(root_package_json, root);
    if let Err(err) = root_package_json.reparse_root(log) {
        bun_core::pretty_errorln!("package.json failed to parse due to error {}", err.name());
        Global::crash();
    }
    Ok(())
}

/// The root `package.json` cache entry (loaded by the caller already).
fn cached_root_entry<'m>(
    manager: &'m mut PackageManager,
    path: &[u8],
) -> (&'m mut MapEntry, &'m mut bun_ast::Log) {
    let PackageManager {
        log,
        workspace_package_json_cache,
        ..
    } = manager;
    match workspace_package_json_cache.get_with_path(
        log,
        path,
        crate::package_manager_real::workspace_package_json_cache::GetJSONOptions {
            guess_indentation: true,
            ..Default::default()
        },
    ) {
        crate::package_manager_real::workspace_package_json_cache::GetResult::Entry(entry) => {
            (entry, log)
        }
        _ => unreachable!("cached by the caller"),
    }
}

/// Runs after `clean_with_logger`: puts moved entries back, replaces dist-tag seeds with the resolved range and writes the entries of nameless positionals; the lockfile catalog is re-derived from the file by `package_json_write_back`.
pub(crate) fn edit_root_after_install(
    manager: &PackageManager,
    root_package_json: &Expr,
) -> Result<bool, AllocError> {
    let adds = &manager.catalog_add.adds;
    if adds.is_empty() {
        return Ok(false);
    }
    let _guard = ExprDisabler::scope();

    let arena = &manager.ast_arena;
    let exact = manager.options.enable.exact_versions();
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let resolutions = lockfile.packages.items_resolution();

    let mut resolved: Vec<PackageID> = vec![INVALID_PACKAGE_ID; adds.len()];
    let mut missing = adds
        .iter()
        .filter(|add| matches!(add.outcome, Outcome::Seeded))
        .count();
    if missing != 0 {
        for (dep, &pkg_id) in lockfile
            .buffers
            .dependencies
            .iter()
            .zip(lockfile.buffers.resolutions.iter())
        {
            if dep.version.tag != dependency::Tag::Catalog
                || pkg_id == INVALID_PACKAGE_ID
                || (pkg_id as usize) >= resolutions.len()
                || resolutions[pkg_id as usize].tag != resolution::Tag::Npm
            {
                continue;
            }
            let Some(i) = adds.iter().position(|add| {
                matches!(add.outcome, Outcome::Seeded)
                    && add.name_hash == dep.name_hash
                    && CatalogMap::same_name(dep.version.catalog().slice(buf), &add.group)
            }) else {
                continue;
            };
            if resolved[i] != INVALID_PACKAGE_ID {
                continue;
            }
            resolved[i] = pkg_id;
            missing -= 1;
            if missing == 0 {
                break;
            }
        }
    }

    let mut changed = false;
    let mut appended: Vec<usize> = Vec::new();
    for (i, (add, &pkg_id)) in adds.iter().zip(resolved.iter()).enumerate() {
        let literal: Vec<u8> = match &add.outcome {
            Outcome::Pending => {
                let Candidate::Resolved(literal) = &add.candidate else {
                    continue;
                };
                let entries = entries_object(root_package_json, &add.group, &add.name, Some(arena))
                    .expect("infallible: prepare() checked workspaces");
                let current = entries.as_property(&add.name);
                if current
                    .as_ref()
                    .and_then(|q| q.expr.as_utf8_string_literal())
                    == Some(&literal[..])
                {
                    continue;
                }
                if current.is_none() {
                    appended.push(i);
                }
                set_property(entries, arena, &add.name, estring(arena, literal));
                changed = true;
                continue;
            }
            Outcome::Reused => continue,
            Outcome::Moved { entry } => entry.to_vec(),
            Outcome::Seeded => {
                if pkg_id == INVALID_PACKAGE_ID {
                    continue;
                }
                // The seed is read back from the lockfile catalog: the requests were rebound to the `catalog:` rows by `bind_update_requests`.
                let Some(seed) = lockfile.catalogs.find(buf, &add.group, &add.name) else {
                    continue;
                };
                if seed.version.tag != dependency::Tag::DistTag {
                    continue;
                }
                let mut literal = Vec::new();
                if seed.version.literal.slice(buf).starts_with(b"npm:") {
                    write!(
                        &mut literal,
                        "npm:{}@",
                        BStr::new(seed.version.dist_tag().name.slice(buf))
                    )
                    .expect("infallible: in-memory write");
                }
                write!(
                    &mut literal,
                    "{}{}",
                    if exact { "" } else { "^" },
                    resolutions[pkg_id as usize].npm().version.fmt(buf)
                )
                .expect("infallible: in-memory write");
                literal
            }
        };

        let Some(mut entries) = entries_object(root_package_json, &add.group, &add.name, None)
        else {
            continue;
        };
        let obj = entries
            .data
            .e_object_mut()
            .expect("infallible: entries_object returns objects");
        let Some(q) = obj.as_property(&add.name) else {
            continue;
        };
        if q.expr.as_utf8_string_literal() == Some(&literal[..]) {
            continue;
        }
        obj.properties.slice_mut()[q.i as usize].value = Some(estring(arena, &literal));
        changed = true;
    }
    alphabetize_appended(root_package_json, adds, &appended);
    Ok(changed)
}
