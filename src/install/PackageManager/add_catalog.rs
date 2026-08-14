use std::io::Write as _;

use bstr::BStr;
use bun_alloc::AllocError;
use bun_ast::{E, Expr, ExprData, Loc, StoreStr};
use bun_collections::VecExt as _;
use bun_core::{Global, Output, strings};
use bun_semver::{self as Semver, SlicedString};

use bun_install::dependency::{self, TagExt as _};
use bun_install::lockfile::CatalogMap;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::{INVALID_PACKAGE_ID, Lockfile, PackageID, PackageNameHash, resolution};
use bun_install_types::DependencyGroup;

use super::add_remove_with_filter::{
    WorkspaceTarget, fetch_entry_root, load_workspace_members, local_relative_path,
    root_package_json_path,
};
use super::package_json_editor::{self as PackageJSONEditor, EditOptions};
use super::update_package_json_and_install::print_package_json_into_cache_entry;
use super::workspace_package_json_cache::MapEntry;
use super::{PackageManager, Subcommand, UpdateRequest};

type ExprDisabler = bun_ast::expr::Disabler;

#[derive(Default)]
pub(crate) struct State {
    enabled: bool,
    auto_use: Vec<PackageNameHash>,
    adds: Vec<Add>,
}

struct Add {
    name: &'static [u8],
    name_hash: PackageNameHash,
    group: Box<[u8]>,
    candidate: Candidate,
    outcome: Outcome,
}

enum Candidate {
    Explicit(Box<[u8]>),
    Existing(Box<[u8]>),
    Latest,
}

impl Candidate {
    fn literal(&self) -> &[u8] {
        match self {
            Candidate::Explicit(literal) | Candidate::Existing(literal) => &literal[..],
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

fn entries_object(root: &Expr, name: &[u8], create: Option<&bun_alloc::Arena>) -> Option<Expr> {
    let Some(workspaces) = root.get(b"workspaces") else {
        if create.is_some() {
            Output::err_generic(
                "--catalog requires a \"workspaces\" field in the root package.json",
                (),
            );
            Global::crash();
        }
        return None;
    };

    let workspaces_is_object = matches!(workspaces.data, ExprData::EObject(_));
    let container = if workspaces_is_object && has_catalogs(&workspaces) {
        workspaces
    } else if has_catalogs(root) || !workspaces_is_object {
        *root
    } else {
        workspaces
    };

    if !CatalogMap::same_name(name, b"") {
        let catalogs = object_property(container, b"catalogs", create)?;
        return object_property(catalogs, name, create);
    }
    let singular = || object_property(container, b"catalog", None);
    let in_catalogs = || {
        object_property(
            object_property(container, b"catalogs", None)?,
            b"default",
            None,
        )
    };
    let existing = if name.is_empty() {
        singular().or_else(in_catalogs)
    } else {
        in_catalogs().or_else(singular)
    };
    existing.or_else(|| object_property(container, b"catalog", create))
}

fn request_literal(request: &UpdateRequest) -> &[u8] {
    request.version.literal.slice(request.version_buf())
}

pub(crate) fn prepare(manager: &mut PackageManager, updates: &[UpdateRequest]) {
    if manager.subcommand != Subcommand::Add || manager.options.global || updates.is_empty() {
        return;
    }
    debug_assert!(
        !manager.catalog_add.enabled
            && manager.catalog_add.auto_use.is_empty()
            && manager.catalog_add.adds.is_empty()
    );

    if manager.options.add_catalog.is_some() {
        for request in updates {
            if !request.is_aliased {
                Output::err_generic(
                    "--catalog can only add packages by name, but got \"{s}\"",
                    (BStr::new(request_literal(request)),),
                );
                Global::crash();
            }
            if request.version.tag == dependency::Tag::Workspace {
                Output::err_generic(
                    "--catalog cannot add a workspace package, but got \"{s}@{s}\"",
                    (BStr::new(request.name), BStr::new(request_literal(request))),
                );
                Global::crash();
            }
            if local_relative_path(request).is_some() {
                Output::err_generic(
                    "--catalog cannot add \"{s}@{s}\": a local path in the catalog would resolve from the workspace root, not from the package that added it",
                    (BStr::new(request.name), BStr::new(request_literal(request))),
                );
                Global::crash();
            }
        }
        let ws = load_workspace_members(manager);
        for request in updates {
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
        manager.catalog_add.enabled = true;
        return;
    }

    let root = fetch_entry_root(
        manager,
        &WorkspaceTarget {
            name: Box::default(),
            name_hash: None,
            package_json_path: root_package_json_path(),
        },
    );
    if !root_defines_catalogs(&root) {
        return;
    }
    manager.catalog_add.enabled = true;
    let Some(entries) = entries_object(&root, b"", None) else {
        return;
    };
    for request in updates.iter().filter(|request| request.is_aliased) {
        let Some(q) = entries.as_property(request.name) else {
            continue;
        };
        let Some(entry_text) = q.expr.as_utf8_string_literal() else {
            continue;
        };
        if request.version.tag == dependency::Tag::Uninitialized
            || request_literal(request) == entry_text
        {
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

fn record_add(state: &mut State, request: &UpdateRequest, group: &[u8], existing: Option<&[u8]>) {
    let candidate = if request.version.tag != dependency::Tag::Uninitialized {
        Candidate::Explicit(request_literal(request).into())
    } else {
        match existing.map(|literal| (dependency::Tag::infer(literal), literal)) {
            Some((dependency::Tag::Npm | dependency::Tag::DistTag, literal)) => {
                Candidate::Existing(literal.into())
            }
            _ => Candidate::Latest,
        }
    };
    match state
        .adds
        .iter_mut()
        .find(|add| add.name_hash == request.name_hash && CatalogMap::same_name(&add.group, group))
    {
        None => state.adds.push(Add {
            name: request.name,
            name_hash: request.name_hash,
            group: group.into(),
            candidate,
            outcome: Outcome::Pending,
        }),
        Some(add) => {
            if matches!(add.candidate, Candidate::Latest)
                && matches!(candidate, Candidate::Existing(_))
            {
                add.candidate = candidate;
            }
        }
    }
}

pub(crate) fn edit_target(
    manager: &mut PackageManager,
    updates: &mut &mut [UpdateRequest],
    package_json: &mut Expr,
    dependency_list: &[u8],
    options: EditOptions,
) -> Result<(), AllocError> {
    if !manager.catalog_add.enabled {
        return PackageJSONEditor::edit(manager, updates, package_json, dependency_list, options);
    }

    let captured: Vec<(PackageNameHash, StoreStr)> = updates
        .iter()
        .filter(|request| request.is_aliased)
        .filter_map(|request| {
            existing_slot(package_json, request.name).map(|slot| (request.name_hash, slot))
        })
        .collect();

    PackageJSONEditor::edit(manager, updates, package_json, dependency_list, options)?;

    let flag = manager.options.add_catalog;
    let arena = &manager.ast_arena;
    let state = &mut manager.catalog_add;
    let flag_literal = flag.map(|name| StoreStr::new(reference_literal(arena, name)));

    for request in updates.iter() {
        if !request.is_aliased {
            continue;
        }
        let Some(e_string) = request.e_string else {
            continue;
        };
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
                    record_add(state, request, catalog_group_of(reference.slice()), None);
                    reference
                }
                (Some(reference), None)
                    if request.version.tag == dependency::Tag::Uninitialized =>
                {
                    reference
                }
                (None, Some(name)) => {
                    record_add(state, request, name, existing.map(|slot| slot.slice()));
                    flag_literal.expect("infallible: flag is Some")
                }
                (None, None) if state.auto_use.contains(&request.name_hash) => {
                    StoreStr::new(b"catalog:")
                }
                _ => continue,
            }
        };
        // SAFETY: same slot `edit` just wrote through (PackageJSONEditor.rs `request.e_string` loop); the tree it points into is still live and no other borrow of it exists here.
        unsafe { (*e_string).data = literal };
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

pub(crate) fn edit_root_before_install(
    manager: &mut PackageManager,
    root_package_json: &Expr,
) -> Result<(), AllocError> {
    let _guard = ExprDisabler::scope();
    let arena = &manager.ast_arena;
    let adds = &mut manager.catalog_add.adds;

    let mut appended: Vec<usize> = Vec::new();
    for (i, add) in adds.iter_mut().enumerate() {
        if !matches!(add.outcome, Outcome::Pending) {
            continue;
        }
        let entries = entries_object(root_package_json, &add.group, Some(arena))
            .expect("infallible: created on demand");
        let existing: Option<Box<[u8]>> = entries
            .as_property(add.name)
            .and_then(|q| q.expr.as_utf8_string_literal().map(Box::from));
        add.outcome = match (existing, &add.candidate) {
            (Some(entry), Candidate::Explicit(wanted)) if *entry == **wanted => Outcome::Reused,
            (Some(entry), Candidate::Explicit(wanted)) => {
                set_property(entries, arena, add.name, estring(arena, wanted));
                if exact_within(wanted, &entry) {
                    Outcome::Moved { entry }
                } else {
                    Outcome::Seeded
                }
            }
            (Some(_), Candidate::Existing(_) | Candidate::Latest) => Outcome::Reused,
            (None, candidate) => {
                set_property(
                    entries,
                    arena,
                    add.name,
                    estring(arena, candidate.literal()),
                );
                appended.push(i);
                Outcome::Seeded
            }
        };
    }

    for (n, &i) in appended.iter().enumerate() {
        let group = &adds[i].group;
        if appended[..n]
            .iter()
            .any(|&j| CatalogMap::same_name(&adds[j].group, group))
        {
            continue;
        }
        let mut entries = entries_object(root_package_json, group, None)
            .expect("infallible: created by the loop above");
        let obj = entries
            .data
            .e_object_mut()
            .expect("infallible: entries_object returns objects");
        if obj.properties.len_u32() > 1 {
            obj.alphabetize_properties();
        }
    }
    Ok(())
}

pub(crate) fn edit_root_entry_before_install(
    manager: &mut PackageManager,
    root_package_json: &mut MapEntry,
) -> Result<(), crate::Error> {
    if manager.catalog_add.adds.is_empty() {
        return Ok(());
    }
    let root = root_package_json.root;
    edit_root_before_install(manager, &root)?;
    print_package_json_into_cache_entry(root_package_json, root);
    if let Err(err) = root_package_json.reparse_root(manager.log_mut()) {
        bun_core::pretty_errorln!("package.json failed to parse due to error {}", err.name());
        Global::crash();
    }
    Ok(())
}

/// Runs after `clean_with_logger`: puts moved entries back and replaces dist-tag seeds with the resolved range; the lockfile catalog is re-derived from the file by `package_json_write_back`.
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
    for (add, &pkg_id) in adds.iter().zip(resolved.iter()) {
        let literal: Vec<u8> = match &add.outcome {
            Outcome::Pending | Outcome::Reused => continue,
            Outcome::Moved { entry } => entry.to_vec(),
            Outcome::Seeded => {
                if pkg_id == INVALID_PACKAGE_ID {
                    continue;
                }
                // The seed is read back from the lockfile catalog: the requests were rebound to the `catalog:` rows by `bind_update_requests`.
                let Some(seed) = lockfile.catalogs.find(buf, &add.group, add.name) else {
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

        let Some(mut entries) = entries_object(root_package_json, &add.group, None) else {
            continue;
        };
        let obj = entries
            .data
            .e_object_mut()
            .expect("infallible: entries_object returns objects");
        let Some(q) = obj.as_property(add.name) else {
            continue;
        };
        if q.expr.as_utf8_string_literal() == Some(&literal[..]) {
            continue;
        }
        obj.properties.slice_mut()[q.i as usize].value = Some(estring(arena, &literal));
        changed = true;
    }
    Ok(changed)
}
