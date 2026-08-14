use std::io::Write as _;

use bstr::BStr;
use bun_alloc::AllocError;
use bun_ast::{E, Expr, ExprData, Loc, StoreStr};
use bun_collections::VecExt as _;
use bun_core::{Global, Output};

use bun_install::dependency;
use bun_install::lockfile::CatalogMap;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::{INVALID_PACKAGE_ID, Lockfile, PackageID, PackageNameHash, resolution};

use super::update_package_json_and_install::print_package_json_into_cache_entry;
use super::workspace_package_json_cache::MapEntry;
use super::{PackageManager, UpdateRequest};

type ExprDisabler = bun_ast::expr::Disabler;

fn catalog_name(manager: &PackageManager) -> &'static [u8] {
    manager
        .options
        .add_catalog
        .expect("add_catalog callers are gated on is_some")
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

fn seed_literal(request: &UpdateRequest) -> &[u8] {
    if request.version.tag == dependency::Tag::Uninitialized {
        return b"latest";
    }
    request.version.literal.slice(request.version_buf())
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

    let has_catalogs =
        |expr: &Expr| expr.get(b"catalog").is_some() || expr.get(b"catalogs").is_some();
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

/// Call right after `PackageJSONEditor::edit` on the same AST: rewrites only the slot `edit` bound per request.
pub(crate) fn rewrite_references(manager: &PackageManager, updates: &[UpdateRequest]) {
    if updates.is_empty() {
        return;
    }

    for request in updates {
        if !request.is_aliased {
            Output::err_generic(
                "--catalog can only add packages by name, but got \"{s}\"",
                (BStr::new(
                    request.version.literal.slice(request.version_buf()),
                ),),
            );
            Global::crash();
        }
        if request.version.tag == dependency::Tag::Workspace {
            Output::err_generic(
                "--catalog cannot add a workspace package, but got \"{s}@{s}\"",
                (
                    BStr::new(request.name),
                    BStr::new(request.version.literal.slice(request.version_buf())),
                ),
            );
            Global::crash();
        }
    }

    let literal = StoreStr::new(reference_literal(&manager.ast_arena, catalog_name(manager)));
    for request in updates {
        let Some(e_string) = request.e_string else {
            continue;
        };
        // SAFETY: same slot `edit` just wrote through (PackageJSONEditor.rs `request.e_string` loop); the tree it points into is still live and no other borrow of it exists here.
        unsafe { (*e_string).data = literal };
    }
}

pub(crate) fn edit_root_before_install(
    manager: &PackageManager,
    root_package_json: &Expr,
    updates: &[UpdateRequest],
) -> Result<(), AllocError> {
    if updates.is_empty() {
        return Ok(());
    }
    let _guard = ExprDisabler::scope();

    let arena = &manager.ast_arena;
    let mut entries = entries_object(root_package_json, catalog_name(manager), Some(arena))
        .expect("infallible: created on demand");
    for request in updates {
        set_property(
            entries,
            arena,
            request.name,
            estring(arena, seed_literal(request)),
        );
    }
    let obj = entries
        .data
        .e_object_mut()
        .expect("infallible: entries_object returns objects");
    if obj.properties.len_u32() > 1 {
        obj.alphabetize_properties();
    }
    Ok(())
}

pub(crate) fn edit_root_entry_before_install(
    manager: &mut PackageManager,
    root_package_json: &mut MapEntry,
) -> Result<(), crate::Error> {
    if manager.update_requests.is_empty() {
        return Ok(());
    }
    let root = root_package_json.root;
    edit_root_before_install(&*manager, &root, &manager.update_requests)?;
    print_package_json_into_cache_entry(root_package_json, root);
    if let Err(err) = root_package_json.reparse_root(manager.log_mut()) {
        bun_core::pretty_errorln!("package.json failed to parse due to error {}", err.name());
        Global::crash();
    }
    Ok(())
}

/// Runs after `clean_with_logger`: replaces the dist-tag seeds in the root's catalog entries with the resolved range; the lockfile catalog is re-derived from the file by `package_json_write_back`.
pub(crate) fn edit_root_after_install(
    manager: &PackageManager,
    root_package_json: &Expr,
    updates: &[UpdateRequest],
) -> Result<bool, AllocError> {
    if updates.is_empty() {
        return Ok(false);
    }
    let _guard = ExprDisabler::scope();
    let name = catalog_name(manager);
    let Some(mut entries) = entries_object(root_package_json, name, None) else {
        return Ok(false);
    };

    let arena = &manager.ast_arena;
    let exact = manager.options.enable.exact_versions();
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let resolutions = lockfile.packages.items_resolution();

    let mut resolved: Vec<(PackageNameHash, PackageID)> = Vec::with_capacity(updates.len());
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
            || !updates
                .iter()
                .any(|request| request.name_hash == dep.name_hash)
            || resolved
                .iter()
                .any(|&(name_hash, _)| name_hash == dep.name_hash)
            || !CatalogMap::same_name(dep.version.catalog().slice(buf), name)
        {
            continue;
        }
        resolved.push((dep.name_hash, pkg_id));
        if resolved.len() == updates.len() {
            break;
        }
    }
    if resolved.is_empty() {
        return Ok(false);
    }

    let mut changed = false;
    for request in updates {
        let Some(&(_, pkg_id)) = resolved
            .iter()
            .find(|&&(name_hash, _)| name_hash == request.name_hash)
        else {
            continue;
        };
        // `request.version` was rebound to the `catalog:` row by `bind_update_requests`, so the dist-tag seed is read back from the lockfile catalog.
        let Some(seed) = lockfile.catalogs.find(buf, name, request.name) else {
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

        let obj = entries
            .data
            .e_object_mut()
            .expect("infallible: entries_object returns objects");
        let Some(q) = obj.as_property(request.name) else {
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
