use bun_collections::{StringArrayHashMap, VecExt};
use std::io::Write as _;

use bun_ast as js_ast;
use bun_ast::{E, Expr, G};
use bun_core::{Global, Output, strings};
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{join_abs_string_buf, platform};
use bun_semver as semver;

use crate::bun_fs::FileSystem;
use bun_install::dependency::{self, DependencyExt as _, TagExt as _};
use bun_install::lockfile::CatalogMap;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::{Dependency, INVALID_PACKAGE_ID, Lockfile, resolution};
use bun_install_types::{DependencyGroup, PackageNameHash};

use super::package_manager_options::{Do, Enable};
use super::workspace_package_json_cache::{GetJSONOptions, GetResult};
use super::{CatalogUpdateInfo, PackageManager, PackageUpdateInfo, Subcommand, UpdateRequest};

type ExprDisabler = bun_ast::expr::Disabler;

const DEPENDENCY_GROUPS: [DependencyGroup; 4] = [
    DependencyGroup::OPTIONAL,
    DependencyGroup::DEV,
    DependencyGroup::DEPENDENCIES,
    DependencyGroup::PEER,
];

#[derive(Default, Clone, Copy)]
pub(crate) struct EditOptions {
    pub exact_versions: bool,
    pub before_install: bool,
}

#[inline]
fn arena_dup<'a>(arena: &'a bun_alloc::Arena, bytes: &[u8]) -> &'a [u8] {
    arena.alloc_slice_copy(bytes)
}

/// `npm:@foo/bar@~1.2.3` -> (`npm:@foo/bar`, `~1.2.3`); `npm:foo` -> (`npm:foo`, `""`).
fn split_npm_alias(literal: &[u8]) -> Option<(&[u8], &[u8])> {
    let literal = strings::trim(literal, &strings::WHITESPACE_CHARS);
    let literal = dependency::without_npm_protocol(literal);
    let (name, version) = Dependency::split_name_and_maybe_version(literal.strip_prefix(b"npm:")?);
    if name.is_empty() || name == b"@" {
        return None;
    }
    Some((
        &literal[..b"npm:".len() + name.len()],
        version.unwrap_or(b""),
    ))
}

/// `version` behind `from`'s `npm:<name>@` (if any), unless it already names a target.
fn with_alias_of<'a>(arena: &'a bun_alloc::Arena, from: &[u8], version: &'a [u8]) -> &'a [u8] {
    match split_npm_alias(from) {
        Some((alias, _)) if split_npm_alias(version).is_none() => {
            let mut v = Vec::new();
            write!(
                &mut v,
                "{}@{}",
                bstr::BStr::new(alias),
                bstr::BStr::new(version)
            )
            .expect("infallible: in-memory write");
            arena_dup(arena, &v)
        }
        _ => version,
    }
}

fn split_ascii_digits(s: &[u8]) -> Option<(&[u8], &[u8])> {
    let n = s.iter().take_while(|b| b.is_ascii_digit()).count();
    (n > 0).then(|| s.split_at(n))
}

fn skip_ascii_digits(s: &[u8]) -> Option<&[u8]> {
    split_ascii_digits(s).map(|(_, rest)| rest)
}

fn is_all_zeros(component: &[u8]) -> bool {
    strings::index_of_any(component, b"123456789").is_none()
}

/// `~1`, `^0` and `^0.0` take their ceiling from the components they omit, so refilling them to x.y.z would narrow the range.
fn short_range_keeps_ceiling(op: u8, tail: &[u8]) -> bool {
    let Some((major, rest)) = split_ascii_digits(tail) else {
        return false;
    };
    let Some((minor, rest)) = rest.strip_prefix(b".").and_then(split_ascii_digits) else {
        return op == b'^' && !is_all_zeros(major);
    };
    if rest
        .strip_prefix(b".")
        .and_then(skip_ascii_digits)
        .is_some()
    {
        return true;
    }
    op == b'~' || !(is_all_zeros(major) && is_all_zeros(minor))
}

/// A plain `bun update` only rewrites `^x…`, `~x…` and exact versions; every other range is kept as written.
fn keeps_declared_range(version_literal: &[u8]) -> bool {
    let mut rest = strings::trim(version_literal, &strings::WHITESPACE_CHARS);
    while let [
        b'=' | b'v' | b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C,
        tail @ ..,
    ] = rest
    {
        rest = tail;
    }
    if let [op @ (b'^' | b'~'), tail @ ..] = rest {
        let tail = strings::trim(tail, &strings::WHITESPACE_CHARS);
        return strings::index_of_any(tail, b" \t|<>").is_some()
            || !short_range_keeps_ceiling(*op, tail);
    }
    let Some(rest) = skip_ascii_digits(rest)
        .and_then(|r| r.strip_prefix(b"."))
        .and_then(skip_ascii_digits)
        .and_then(|r| r.strip_prefix(b"."))
        .and_then(skip_ascii_digits)
    else {
        return true;
    };
    match rest {
        [] => false,
        [b'-' | b'+', tail @ ..] => strings::index_of_any(tail, b" \t|<>").is_some(),
        _ => true,
    }
}

/// `resolved` in the pin style of the declared literal (None = the literal is kept as written); --latest rewrites dist-tags too.
pub fn updated_version_literal(
    original_version_literal: &[u8],
    resolved: semver::Version,
    resolved_buf: &[u8],
    exact_versions: bool,
    update_to_latest: bool,
) -> Option<Vec<u8>> {
    let mut v = Vec::new();
    let version_literal = match split_npm_alias(original_version_literal) {
        Some((alias, version_literal)) => {
            write!(&mut v, "{}@", bstr::BStr::new(alias)).expect("infallible: in-memory write");
            version_literal
        }
        None => dependency::without_npm_protocol(original_version_literal),
    };
    if !update_to_latest && keeps_declared_range(version_literal) {
        return None;
    }

    // `=1.0.0` round-trips as `=2.0.0`; `which_version_is_pinned` skips the `=` and reports Patch.
    let exact_prefix =
        if strings::trim(version_literal, &strings::WHITESPACE_CHARS).starts_with(b"=") {
            "="
        } else {
            ""
        };
    let range_prefix = if exact_versions {
        exact_prefix
    } else {
        match semver::Version::which_version_is_pinned(version_literal) {
            semver::PinnedVersion::Patch => exact_prefix,
            semver::PinnedVersion::Minor => "~",
            semver::PinnedVersion::Major => "^",
        }
    };
    write!(&mut v, "{}{}", range_prefix, resolved.fmt(resolved_buf))
        .expect("infallible: in-memory write");
    Some(v)
}

/// Shallow-copy a `G::Property` for the JSON-editing path. Only `key`/`value`
/// (both `Option<Expr>`, `Copy`) are populated by the JSON parser; the rest
/// (`ts_decorators`, `class_static_block`, …) are always default for parsed
/// `package.json`.
#[inline]
fn copy_property(p: &G::Property) -> G::Property {
    G::Property {
        key: p.key,
        value: p.value,
        ..G::Property::default()
    }
}

pub(crate) fn edit_patched_dependencies(
    manager: &mut PackageManager,
    package_json: &mut Expr,
    patch_key: &[u8],
    patchfile_path: &[u8],
) -> Result<(), bun_alloc::AllocError> {
    let arena = &manager.ast_arena;
    // const pkg_to_patch = manager.
    let mut patched_dependencies = E::Object::default();
    if let Some(query) = package_json.as_property(b"patchedDependencies") {
        if let bun_ast::ExprData::EObject(obj) = &query.expr.data {
            // Preserve the formatting fields so the printed
            // `patchedDependencies` keeps its original single-line / brace layout.
            patched_dependencies.is_single_line = obj.is_single_line;
            patched_dependencies.close_brace_loc = obj.close_brace_loc;
            patched_dependencies.comma_after_spread = obj.comma_after_spread;
            patched_dependencies.is_parenthesized = obj.is_parenthesized;
            patched_dependencies.was_originally_macro = obj.was_originally_macro;
            for p in obj.properties.slice() {
                VecExt::append(&mut patched_dependencies.properties, copy_property(p));
            }
        }
    }

    let patchfile_expr = Expr::init(
        E::EString::init(arena_dup(arena, patchfile_path)),
        bun_ast::Loc::EMPTY,
    );

    patched_dependencies.put(arena, arena_dup(arena, patch_key), patchfile_expr)?;

    package_json.data.e_object_mut().unwrap().put(
        arena,
        b"patchedDependencies",
        Expr::init(patched_dependencies, bun_ast::Loc::EMPTY),
    )?;
    Ok(())
}

pub fn edit_trusted_dependencies(
    package_json: &mut Expr,
    names_to_add: &mut [Box<[u8]>],
) -> Result<(), bun_alloc::AllocError> {
    let mut len = names_to_add.len();

    let mut trusted_dependencies: &[Expr] = &[];
    if let Some(query) = package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
        if let bun_ast::ExprData::EArray(arr) = &query.expr.data {
            // SAFETY: `arr` is a `StoreRef` into the AST arena which outlives
            // this function; lifetime erased per the parser's `Str` convention.
            trusted_dependencies = unsafe { bun_ptr::detach_lifetime(arr.items.slice()) };
        }
    }

    let mut i = len;
    while i > 0 {
        i -= 1;
        let name = &names_to_add[i];
        for item in trusted_dependencies.iter() {
            if let bun_ast::ExprData::EString(s) = &item.data {
                if s.eql_bytes(name) {
                    names_to_add.swap(i, len - 1);
                    len -= 1;
                    break;
                }
            }
        }
    }

    let trusted_dependencies_to_add = len;
    let new_trusted_deps = js_ast::ExprNodeList::from_owned_slice(
        (trusted_dependencies.iter().copied())
            .chain(
                (names_to_add[..len].iter().rev())
                    .map(|name| Expr::init(E::EString::init(name), bun_ast::Loc::EMPTY)),
            )
            .collect(),
    );

    let mut needs_new_trusted_dependencies_list = true;
    let mut trusted_dependencies_array: Expr = 'brk: {
        if let Some(query) = package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
            if matches!(query.expr.data, bun_ast::ExprData::EArray(_)) {
                needs_new_trusted_dependencies_list = false;
                break 'brk query.expr;
            }
        }

        Expr::init(
            E::Array {
                items: js_ast::ExprNodeList::from_slice(new_trusted_deps.slice()),
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        )
    };

    if trusted_dependencies_to_add > 0 && new_trusted_deps.len_u32() > 0 {
        let arr = trusted_dependencies_array
            .data
            .e_array_mut()
            .expect("infallible: variant checked");
        arr.items = new_trusted_deps;
        arr.alphabetize_strings();
    }

    if needs_new_trusted_dependencies_list {
        let mut root_properties: Vec<G::Property> = match package_json.data.e_object() {
            Some(obj) => obj.properties.slice().iter().map(copy_property).collect(),
            None => Vec::new(),
        };
        root_properties.push(G::Property {
            key: Some(Expr::init(
                E::EString::init(TRUSTED_DEPENDENCIES_STRING),
                bun_ast::Loc::EMPTY,
            )),
            value: Some(trusted_dependencies_array),
            ..Default::default()
        });
        *package_json = Expr::init(
            E::Object {
                properties: G::PropertyList::move_from_list(root_properties),
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        );
    }
    Ok(())
}

/// When `bun update` is called without package names, all dependencies are updated.
/// This function will identify the current workspace and update all changed package
/// versions. Returns whether any entry of `current_package_json` was rewritten.
pub(crate) fn edit_update_no_args(
    manager: &mut PackageManager,
    current_package_json: &mut Expr,
    options: EditOptions,
) -> Result<bool, bun_alloc::AllocError> {
    edit_update_entries(
        &manager.lockfile,
        &manager.ast_arena,
        &mut manager.updating_packages,
        manager.workspace_name_hash,
        manager.options.do_.contains(Do::UPDATE_TO_LATEST),
        current_package_json,
        options,
        &|_, _| true,
    )
}

/// `bun update <name>`: entries declared as `<key>: npm:<name>@…` move like every entry of a bare update does.
fn edit_update_aliases_of_requests(
    manager: &mut PackageManager,
    updates: &[UpdateRequest],
    current_package_json: &mut Expr,
    options: EditOptions,
) -> Result<bool, bun_alloc::AllocError> {
    let is_request = |name: &[u8]| updates.iter().any(|r| r.is_aliased && r.name == name);
    let is_alias_of_request = |key: &[u8], literal: &[u8]| {
        split_npm_alias(literal).is_some_and(|(alias, _)| is_request(&alias[b"npm:".len()..]))
            && !is_request(key)
    };
    edit_update_entries(
        &manager.lockfile,
        &manager.ast_arena,
        &mut manager.updating_packages,
        manager.workspace_name_hash,
        manager.options.do_.contains(Do::UPDATE_TO_LATEST),
        current_package_json,
        options,
        &is_alias_of_request,
    )
}

/// The tag of a package.json literal as `bun install` reads it (leading whitespace ignored).
fn literal_tag(literal: &[u8]) -> dependency::Tag {
    dependency::Tag::infer(dependency::trim_literal(literal))
}

pub(crate) fn string_pair(property: &G::Property) -> Option<(&[u8], &[u8])> {
    property
        .key
        .as_ref()
        .and_then(Expr::as_utf8_string_literal)
        .zip(
            property
                .value
                .as_ref()
                .and_then(Expr::as_utf8_string_literal),
        )
}

/// Split borrows, for callers holding a `&mut` to another `PackageManager` field.
pub(crate) fn edit_update_entries(
    lockfile: &crate::Lockfile,
    arena: &bun_alloc::Arena,
    updating_packages: &mut StringArrayHashMap<PackageUpdateInfo>,
    workspace_name_hash: Option<PackageNameHash>,
    update_to_latest: bool,
    current_package_json: &mut Expr,
    options: EditOptions,
    selected: &dyn Fn(&[u8], &[u8]) -> bool,
) -> Result<bool, bun_alloc::AllocError> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    let _guard = ExprDisabler::scope();
    let mut changed = false;

    for group in DEPENDENCY_GROUPS {
        let Some(mut entries) = current_package_json
            .as_property(group.prop)
            .and_then(|root| root.expr.data.e_object())
        else {
            continue;
        };
        if options.before_install {
            // --latest steers the row at resolve time (`picks_latest_tag`).
            for dep in entries.properties.slice() {
                let Some((key_str, version_literal)) = string_pair(dep) else {
                    continue;
                };
                let tag = literal_tag(version_literal);

                // `catalog:` is for `record_catalog_entries` and `edit_catalogs_after_update`.
                if (tag != dependency::Tag::Npm
                    && (tag != dependency::Tag::DistTag || !update_to_latest))
                    || !selected(key_str, version_literal)
                {
                    continue;
                }
                let entry = updating_packages.get_or_put(key_str)?;

                // The first of `dependency_groups` wins, as when picking the installed version.
                if entry.found_existing {
                    continue;
                }

                *entry.value_ptr = PackageUpdateInfo {
                    original_version_literal: Box::from(version_literal),
                    ..Default::default()
                };
            }
            continue;
        }

        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let workspace = lockfile.get_workspace_package_id(workspace_name_hash) as usize;
        let packages = lockfile.packages.slice();
        let resolutions = packages.items_resolution();
        let workspace_deps: &[Dependency] =
            packages.items_dependencies()[workspace].get(lockfile.buffers.dependencies.as_slice());
        let workspace_resolution_ids =
            packages.items_resolutions()[workspace].get(lockfile.buffers.resolutions.as_slice());
        debug_assert_eq!(workspace_deps.len(), workspace_resolution_ids.len());

        for dep in entries.properties.slice_mut() {
            let Some((key_str, value_literal)) = string_pair(dep) else {
                continue;
            };
            // `catalog:` references are never rewritten. The root's catalog entry is updated
            // instead.
            if literal_tag(value_literal) == dependency::Tag::Catalog
                || !selected(key_str, value_literal)
            {
                continue;
            }

            // Only the first dependency group naming the package is rewritten.
            let Some(entry) = updating_packages.get_mut(key_str) else {
                continue;
            };
            if entry.written_back {
                continue;
            }
            entry.written_back = true;
            let Some((workspace_dep, resolution)) = (workspace_deps.iter())
                .zip(workspace_resolution_ids)
                .filter(|&(_, &package_id)| package_id != INVALID_PACKAGE_ID)
                .map(|(row, &package_id)| (row, &resolutions[package_id as usize]))
                .find(|(workspace_dep, resolution)| {
                    resolution.tag == resolution::Tag::Npm
                        && strings::eql_long(workspace_dep.name.slice(string_buf), key_str, true)
                })
            else {
                continue;
            };

            // an exact pin is not moved by a plain `bun update`
            if !update_to_latest
                && lockfile
                    .resolve_catalog_dependency(workspace_dep)
                    .unwrap_or_else(|| workspace_dep.version.clone())
                    .try_npm()
                    .is_some_and(|npm_version| npm_version.version.is_exact())
            {
                continue;
            }

            // A peer range states which versions the package works with, so `--exact` never pins
            // it, and `--latest` leaves it alone when it already allows the resolved version.
            let is_peer = group.prop == DependencyGroup::PEER.prop;
            let resolved = resolution.npm().version;
            // A package in both devDependencies and peerDependencies has two lockfile entries, so
            // check the peer one.
            let allowed = is_peer
                && workspace_deps.iter().any(|row| {
                    row.behavior.is_peer()
                        && row.name_hash == workspace_dep.name_hash
                        && row.version.try_npm().is_some_and(|npm_version| {
                            npm_version
                                .version
                                .satisfies(resolved, string_buf, string_buf)
                        })
                });
            let Some(new_version) = updated_version_literal(
                &entry.original_version_literal,
                resolved,
                string_buf,
                options.exact_versions && !is_peer,
                update_to_latest && !allowed,
            )
            .filter(|new_version| new_version.as_slice() != value_literal) else {
                continue;
            };
            changed = true;
            dep.value = Some(Expr::allocate(
                arena,
                E::EString::init(arena_dup(arena, &new_version)),
                bun_ast::Loc::EMPTY,
            ));
        }
    }
    Ok(changed)
}

/// Calls `f(catalog_name, entries_object)` for each catalog in the root
/// package.json, matching the precedence `CatalogMap::parse_append` uses.
pub(crate) fn for_each_catalog_object(
    root_package_json: &Expr,
    mut f: impl FnMut(&[u8], Expr) -> Result<(), bun_alloc::AllocError>,
) -> Result<(), bun_alloc::AllocError> {
    let Some(workspaces) = root_package_json.get(b"workspaces") else {
        return Ok(());
    };

    for container in [workspaces, *root_package_json] {
        let mut found_any = false;
        if let Some(default_catalog) = container.get(b"catalog") {
            found_any = true;
            f(b"", default_catalog)?;
        }

        if let Some(catalogs) = container.get(b"catalogs") {
            found_any = true;
            if let bun_ast::ExprData::EObject(groups) = &catalogs.data {
                for group in groups.properties.slice() {
                    let Some(key) = &group.key else { continue };
                    let Some(catalog_name) = key.as_utf8_string_literal() else {
                        continue;
                    };
                    let Some(value) = &group.value else { continue };
                    f(catalog_name, *value)?;
                }
            }
        }

        if found_any {
            break;
        }
    }

    Ok(())
}

/// Returns the catalog object in the root package.json that `catalog:<catalog_name>` reads
/// `dep_name` from. Like `CatalogMap::locate`, it prefers the exact spelling of `catalog_name`.
pub fn catalog_object_of(
    root_package_json: &Expr,
    catalog_name: &[u8],
    dep_name: &[u8],
) -> Option<bun_ast::StoreRef<E::Object>> {
    let mut found = None;
    let _ = for_each_catalog_object(root_package_json, |name, catalog| {
        if CatalogMap::same_name(name, catalog_name)
            && (found.is_none() || name == catalog_name)
            && let Some(entries) = catalog.data.e_object()
            && entries.has_property(dep_name)
        {
            found = Some(entries);
        }
        Ok(())
    });
    found
}

/// Records the declared version of every catalog entry a bare `bun update` may rewrite.
pub(crate) fn record_catalog_entries(
    manager: &mut PackageManager,
    root_package_json: &Expr,
) -> Result<(), bun_alloc::AllocError> {
    // see note in `edit_update_no_args` — always avoid the store
    let _guard = ExprDisabler::scope();

    debug_assert!(manager.updating_catalogs.is_empty());

    let update_to_latest = manager.options.do_.contains(Do::UPDATE_TO_LATEST);

    let updating_catalogs = &mut manager.updating_catalogs;

    for_each_catalog_object(root_package_json, |catalog_name, catalog_expr| {
        let Some(entries) = catalog_expr.data.e_object() else {
            return Ok(());
        };
        for (dep_name, literal) in entries.properties.slice().iter().filter_map(string_pair) {
            let tag = literal_tag(literal);

            // same tag rule as direct dependencies
            if tag != dependency::Tag::Npm && (tag != dependency::Tag::DistTag || !update_to_latest)
            {
                continue;
            }

            updating_catalogs.push(CatalogUpdateInfo {
                catalog_name: Box::from(catalog_name),
                dep_name: Box::from(dep_name),
                original_version_literal: Box::from(literal),
                new_version_literal: None,
            });
        }
        Ok(())
    })
}

/// A bare `bun update --latest` that targets the root.
#[inline]
pub(crate) fn steers_catalogs_to_latest(manager: &PackageManager) -> bool {
    !manager.updating_catalogs.is_empty() && manager.options.do_.contains(Do::UPDATE_TO_LATEST)
}

/// A catalog entry that's only used through an override keeps its range, because no dependency
/// reports a version back to it.
#[cold]
#[inline(never)]
pub(crate) fn steer_used_catalogs_to_latest(
    manager: &mut PackageManager,
    parsed: Option<&mut Lockfile>,
) -> Result<(), bun_alloc::AllocError> {
    // see note in `edit_update_no_args` — always avoid the store
    let _guard = ExprDisabler::scope();
    let log = manager.log_mut();
    let package_json_cache = &mut manager.workspace_package_json_cache;
    let lockfile = parsed.unwrap_or(&mut *manager.lockfile);

    let top_level = strings::without_trailing_slash(FileSystem::instance().top_level_dir());
    let mut path_buf = path_buffer_pool::get();
    // The root's package.json, then each member's.
    for workspace in 0..=lockfile.workspace_paths.count() {
        let workspace_path: &[u8] = match workspace.checked_sub(1) {
            Some(member) => lockfile.workspace_paths.values()[member]
                .slice(lockfile.buffers.string_bytes.as_slice()),
            None => b"",
        };
        let package_json_path = join_abs_string_buf::<platform::Auto>(
            top_level,
            &mut path_buf.0,
            &[workspace_path, b"package.json"],
        );
        let options = GetJSONOptions {
            init_reset_store: false,
            ..Default::default()
        };
        let GetResult::Entry(entry) =
            package_json_cache.get_with_path(log, package_json_path, options)
        else {
            continue;
        };
        let package_json = entry.root;
        let mut string_buf = semver::semver_string::Buf {
            bytes: &mut lockfile.buffers.string_bytes,
            pool: &mut lockfile.string_pool,
        };
        for group in DependencyGroup::FOUR {
            let Some(dependencies) = package_json.get(group.prop) else {
                continue;
            };
            dependencies.try_for_each_property(|name, _, value| {
                let Some(catalog_name) = value.as_utf8_string_literal().and_then(|literal| {
                    dependency::trim_literal(literal).strip_prefix(b"catalog:")
                }) else {
                    return Ok(());
                };
                lockfile.catalogs.steer_to_latest(
                    &mut string_buf,
                    strings::trim(catalog_name, &strings::WHITESPACE_CHARS),
                    name,
                )
            })?;
        }
    }
    Ok(())
}

/// Runs on the loaded lockfile, before the differ, so that the summary can print a catalog entry's
/// change as an update.
pub(crate) fn record_catalog_originals(
    manager: &mut PackageManager,
) -> Result<(), bun_alloc::AllocError> {
    let infos: &[CatalogUpdateInfo] = &manager.updating_catalogs;
    if infos.is_empty() {
        return Ok(());
    }
    let by_name = CatalogInfoIndex::init(infos)?;
    let lockfile: &Lockfile = &manager.lockfile;
    let updating_packages = &mut manager.updating_packages;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let package_resolutions = lockfile.packages.items_resolution();

    let dependencies = lockfile.buffers.dependencies.iter();
    for (dep, &package_id) in dependencies.zip(lockfile.buffers.resolutions.iter()) {
        if dep.version.tag != dependency::Tag::Catalog {
            continue;
        }
        let resolution = package_resolutions.get(package_id as usize);
        let Some(resolution) = resolution.filter(|r| r.tag == resolution::Tag::Npm) else {
            continue;
        };
        let dep_name = dep.name.slice(string_buf);
        let catalog_name = dep.version.catalog().slice(string_buf);
        let Some(info) = by_name
            .pick(infos, dep_name, catalog_name)
            .map(|i| &infos[i])
        else {
            continue;
        };
        let key = PackageUpdateInfo::catalog_row_key(dep_name, catalog_name);
        let entry = updating_packages.get_or_put(&key)?;
        if entry.found_existing {
            continue;
        }
        *entry.value_ptr = PackageUpdateInfo {
            original_version_literal: info.original_version_literal.clone(),
            ..Default::default()
        };
        entry
            .value_ptr
            .set_original_version(resolution.npm().version, string_buf);
    }
    Ok(())
}

/// Writes the literal that each recorded catalog entry resolved to into the root AST. Returns true
/// if anything changed.
pub(crate) fn edit_catalogs_after_update(
    manager: &mut PackageManager,
    root_package_json: &Expr,
) -> Result<bool, bun_alloc::AllocError> {
    // see note in `edit_update_no_args` — always avoid the store
    let _guard = ExprDisabler::scope();

    let mut infos = core::mem::take(&mut manager.updating_catalogs);
    if infos.is_empty() {
        return Ok(false);
    }
    let index = CatalogInfoIndex::init(&infos)?;
    resolve_catalog_literals(
        &manager.lockfile,
        &mut infos,
        &index,
        manager.options.do_.contains(Do::UPDATE_TO_LATEST),
        manager.options.enable.exact_versions(),
    );

    let arena = &manager.ast_arena;
    let mut changed = false;
    for_each_catalog_object(root_package_json, |catalog_name, catalog_expr| {
        let Some(mut entries) = catalog_expr.data.e_object() else {
            return Ok(());
        };
        for dep in entries.properties.slice_mut() {
            let Some(new_literal) = (dep.key.as_ref())
                .and_then(Expr::as_utf8_string_literal)
                .and_then(|key_str| index.pick(&infos, key_str, catalog_name))
                .and_then(|i| {
                    let info = &infos[i];
                    info.new_version_literal.as_deref().filter(|new_literal| {
                        !strings::eql_long(new_literal, &info.original_version_literal, true)
                    })
                })
            else {
                continue;
            };

            changed = true;
            dep.value = Some(Expr::allocate(
                arena,
                E::EString::init(arena_dup(arena, new_literal)),
                bun_ast::Loc::EMPTY,
            ));
        }
        Ok(())
    })?;

    Ok(changed)
}

/// Indices into `updating_catalogs` keyed by dependency name.
struct CatalogInfoIndex(StringArrayHashMap<Vec<usize>>);

impl CatalogInfoIndex {
    fn init(infos: &[CatalogUpdateInfo]) -> Result<CatalogInfoIndex, bun_alloc::AllocError> {
        let mut map = StringArrayHashMap::<Vec<usize>>::with_capacity(infos.len());
        for (i, info) in infos.iter().enumerate() {
            map.get_or_put(&info.dep_name)?.value_ptr.push(i);
        }
        Ok(CatalogInfoIndex(map))
    }

    /// An entry spelled exactly like `catalog_name` wins over the `catalog:` / `catalog:default` equivalence.
    fn pick(
        &self,
        infos: &[CatalogUpdateInfo],
        dep_name: &[u8],
        catalog_name: &[u8],
    ) -> Option<usize> {
        let candidates = self.0.get(dep_name)?;
        candidates
            .iter()
            .copied()
            .find(|&i| &*infos[i].catalog_name == catalog_name)
            .or_else(|| {
                candidates
                    .iter()
                    .copied()
                    .find(|&i| CatalogMap::same_name(&infos[i].catalog_name, catalog_name))
            })
    }
}

fn resolve_catalog_literals(
    lockfile: &Lockfile,
    infos: &mut [CatalogUpdateInfo],
    by_name: &CatalogInfoIndex,
    update_to_latest: bool,
    exact_versions: bool,
) {
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let package_resolutions = lockfile.packages.items_resolution();

    debug_assert_eq!(
        lockfile.buffers.dependencies.len(),
        lockfile.buffers.resolutions.len()
    );
    for (dep, &package_id) in lockfile
        .buffers
        .dependencies
        .iter()
        .zip(lockfile.buffers.resolutions.iter())
    {
        if dep.version.tag != dependency::Tag::Catalog || package_id == INVALID_PACKAGE_ID {
            continue;
        }

        let catalog_name = dep.version.catalog().slice(string_buf);
        let Some(index) = by_name
            .pick(infos, dep.name.slice(string_buf), catalog_name)
            .filter(|&index| infos[index].new_version_literal.is_none())
        else {
            continue;
        };

        let resolution = &package_resolutions[package_id as usize];
        if resolution.tag != resolution::Tag::Npm {
            continue;
        }

        if !update_to_latest {
            // plain `bun update` does not move an exact pin (matches direct-dep behavior)
            let resolved_version = lockfile
                .resolve_catalog_dependency(dep)
                .unwrap_or_else(|| dep.version.clone());
            if let Some(npm_version) = resolved_version.try_npm() {
                if npm_version.version.is_exact() {
                    continue;
                }
            }
        }

        // `--exact` does not pin a catalog entry that a `catalog:` peer dependency uses, because
        // publishing copies the entry into that peer range.
        let exact_versions = exact_versions
            && !lockfile.buffers.dependencies.iter().any(|row| {
                row.behavior.is_peer()
                    && row.version.tag == dependency::Tag::Catalog
                    && by_name.pick(
                        infos,
                        row.name.slice(string_buf),
                        row.version.catalog().slice(string_buf),
                    ) == Some(index)
            });
        if let Some(new_literal) = updated_version_literal(
            &infos[index].original_version_literal,
            resolution.npm().version,
            string_buf,
            exact_versions,
            update_to_latest,
        ) {
            infos[index].new_version_literal = Some(new_literal.into_boxed_slice());
        }
    }
}

/// Also removes `list` once nothing is left in it. Returns whether `name` was there.
pub(crate) fn remove_entry(package_json: &mut Expr, list: &[u8], name: &[u8]) -> bool {
    let Some(query) = package_json.as_property(list) else {
        return false;
    };
    let Some(mut entries) = query.expr.data.e_object() else {
        return false;
    };
    let before = entries.properties.len();
    entries.properties.retain(|property| {
        !property
            .key
            .and_then(|key| key.data.e_string())
            .is_some_and(|key| key.eql_bytes(name))
    });
    if entries.properties.len() == before {
        return false;
    }
    if entries.properties.is_empty() {
        let _ = package_json
            .data
            .as_e_object_mut()
            .properties
            .remove(query.i as usize);
    }
    true
}

fn string_entry(
    package_json: &Expr,
    list: &[u8],
    name: &[u8],
) -> Option<bun_ast::StoreRef<E::EString>> {
    let entry = package_json.as_property(list)?.expr.as_property(name)?;
    entry.expr.data.e_string()
}

pub(crate) fn moves_to_target(manager: &PackageManager) -> bool {
    manager.options.enable.contains(Enable::MOVE_TO_GROUP)
}

pub(crate) enum Declared {
    Stays,
    TakesSpec,
    Removed,
}

/// Decides what happens to the entry that `list` already has for a package that `bun add` puts into
/// `target`.
pub(crate) fn fate_of_declared(list: &[u8], target: &[u8], move_to_target: bool) -> Declared {
    let peer = DependencyGroup::PEER.prop;
    if list == target {
        Declared::TakesSpec
    } else if !move_to_target {
        // A peer entry and an entry in another list can have the same name. Neither replaces the
        // other.
        if (list == peer) == (target == peer) {
            Declared::TakesSpec
        } else {
            Declared::Stays
        }
    } else if list == peer {
        Declared::Stays
    } else if target == peer && list == DependencyGroup::DEV.prop {
        // The entry that provides the peer during development follows the peer's range.
        Declared::TakesSpec
    } else {
        Declared::Removed
    }
}

/// Edits the dependency lists for `updates` and returns whether anything was rewritten; `trustedDependencies` is added later by `package_json_write_back::flush`.
pub(crate) fn edit(
    manager: &mut PackageManager,
    // Pointer-to-slice whose `.len` is shrunk in place.
    updates: &mut &mut [UpdateRequest],
    current_package_json: &mut Expr,
    dependency_list: &[u8],
    options: EditOptions,
) -> Result<bool, bun_alloc::AllocError> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    let _guard = ExprDisabler::scope();

    // Process-lifetime arena for AST
    // nodes that must outlive `Expr.Data.Store.reset()`. See `PackageManager.ast_arena`.
    let update_to_latest = manager.subcommand == Subcommand::Update
        && manager.options.do_.contains(Do::UPDATE_TO_LATEST);
    if update_to_latest && options.before_install {
        if let Some(request) = updates.iter().find(|request| {
            !request
                .version
                .literal
                .slice(request.version_buf())
                .is_empty()
        }) {
            Output::err_generic(
                "--latest cannot be combined with a version: {}\n",
                (bun_core::fmt::for_terminal(bstr::BStr::new(
                    request.version_buf(),
                )),),
            );
            Global::crash();
        }
    }
    let mut changed = manager.subcommand == Subcommand::Update
        && edit_update_aliases_of_requests(manager, &**updates, current_package_json, options)?;

    // `arena` is a disjoint-field borrow held across the `&mut manager.updating_packages` accesses below.
    let arena = &manager.ast_arena;

    let mut remaining = updates.len();
    let mut replacing: usize = 0;
    let only_add_missing = manager.options.enable.only_missing();
    let move_to_target = moves_to_target(manager);
    // `--latest` resolves every entry for a name to `latest`. Only the first match is rewritten, so
    // the groups are scanned in the order that finds the entry an install uses.
    let lists = if update_to_latest {
        DEPENDENCY_GROUPS
    } else {
        DependencyGroup::FOUR
    };
    // `package_json_write_back::fold_resolved_positionals` did this to the lockfile rows.
    let fold_positionals = !options.before_install
        && manager.subcommand == Subcommand::Add
        && manager.options.add_catalog.is_none();
    // Pairs of (the slot of a request, another slot that gets the same value).
    let mut also_declared = Vec::new();

    // There are three possible scenarios here
    // 1. There is no "dependencies" (or equivalent list) or it is empty
    // 2. There is a "dependencies" (or equivalent list), but the package name already exists in a separate list
    // 3. There is a "dependencies" (or equivalent list), and the package name exists in multiple lists
    // Try to use the existing spot in the dependencies list if possible
    {
        {
            let mut i: usize = 0;
            'loop_: while i < updates.len() {
                let request = &mut updates[i];
                // `"<spec>": "<spec>"` has a name now, which the file may declare already.
                let resolved_name = if fold_positionals
                    && !request.is_aliased
                    && string_entry(current_package_json, dependency_list, request.get_name())
                        .is_some()
                {
                    request
                        .get_name_in_lockfile(&manager.lockfile)
                        .filter(|name| !name.is_empty() && *name != request.get_name())
                        .map(|name| arena_dup(arena, name))
                } else {
                    None
                };
                if let Some(name) = resolved_name {
                    // An optional peer isn't updated here. The rebuild below handles it.
                    let optional_peer = current_package_json
                        .as_property(b"peerDependenciesMeta")
                        .and_then(|meta| meta.expr.as_property(name))
                        .and_then(|entry| entry.expr.as_property(b"optional"))
                        .is_some_and(|optional| {
                            matches!(&optional.expr.data, bun_ast::ExprData::EBoolean(b) if b.value)
                        });
                    let mut slot = None;
                    for list in DependencyGroup::FOUR.map(|g| g.prop) {
                        if optional_peer && list == DependencyGroup::PEER.prop {
                            continue;
                        }
                        let Some(declared) = string_entry(current_package_json, list, name) else {
                            continue;
                        };
                        match fate_of_declared(list, dependency_list, move_to_target) {
                            Declared::Stays => {}
                            Declared::Removed => {
                                changed |= remove_entry(current_package_json, list, name);
                            }
                            // The dev entry beside a new peer entry follows it at the end.
                            Declared::TakesSpec if move_to_target && list != dependency_list => {}
                            Declared::TakesSpec => match slot {
                                None => slot = Some(declared),
                                Some(first) => also_declared.push((first, declared)),
                            },
                        }
                    }
                    if let Some(slot) = slot {
                        remove_entry(current_package_json, dependency_list, request.get_name());
                        request.e_string = Some(slot.as_ptr());
                        remaining -= 1;
                        changed = true;
                        i += 1;
                        continue 'loop_;
                    }
                }
                // Unless `move_to_target` is set, the scan stops at the first group with the name.
                'dependency_group: for list in lists.map(|g| g.prop) {
                    if let Some(query) = current_package_json.as_property(list) {
                        if matches!(query.expr.data, bun_ast::ExprData::EObject(_)) {
                            let name = request.get_name();

                            if let Some(value) = query.expr.as_property(name) {
                                if matches!(value.expr.data, bun_ast::ExprData::EString(_)) {
                                    // `bun update <pkg>` keeps a `catalog:` reference intact.
                                    let keep_catalog_reference = manager.subcommand
                                        == Subcommand::Update
                                        && value.expr.as_utf8_string_literal().is_some_and(
                                            |version_literal| {
                                                literal_tag(version_literal)
                                                    == dependency::Tag::Catalog
                                            },
                                        );
                                    let in_target_list =
                                        strings::eql_long(list, dependency_list, true);

                                    // `bun update <name>` edits the slot in place; the rebuild below re-sorts the keys.
                                    if request.package_id != INVALID_PACKAGE_ID
                                        && manager.subcommand != Subcommand::Update
                                        && in_target_list
                                        && !keep_catalog_reference
                                    {
                                        replacing += 1;
                                    } else if move_to_target && !in_target_list {
                                        if let Declared::Removed =
                                            fate_of_declared(list, dependency_list, true)
                                        {
                                            changed |=
                                                remove_entry(current_package_json, list, name);
                                        }
                                    } else {
                                        if manager.subcommand == Subcommand::Update
                                            && options.before_install
                                        {
                                            'add_packages_to_update: {
                                                let Some(version_literal) =
                                                    value.expr.as_utf8_string_literal()
                                                else {
                                                    break 'add_packages_to_update;
                                                };
                                                let tag = literal_tag(version_literal);

                                                if tag != dependency::Tag::Npm
                                                    && tag != dependency::Tag::DistTag
                                                {
                                                    break 'add_packages_to_update;
                                                }

                                                // Capture an
                                                // owned copy of the literal before borrowing
                                                // `manager.updating_packages` mutably.
                                                let version_literal_owned =
                                                    Box::<[u8]>::from(version_literal);
                                                let entry =
                                                    manager.updating_packages.get_or_put(name)?;

                                                // first come, first serve
                                                if entry.found_existing {
                                                    break 'add_packages_to_update;
                                                }

                                                *entry.value_ptr = PackageUpdateInfo {
                                                    original_version_literal: version_literal_owned,
                                                    ..Default::default()
                                                };
                                            }
                                        }
                                        if !only_add_missing {
                                            request.e_string = Some(
                                                value
                                                    .expr
                                                    .data
                                                    .e_string()
                                                    .expect("infallible: variant checked")
                                                    .as_ptr(),
                                            );
                                            remaining -= 1;
                                        } else {
                                            let last = updates.len() - 1;
                                            if i < last {
                                                updates.swap(i, last);
                                            }
                                            // Shrink the slice header.
                                            *updates = &mut core::mem::take(updates)[..last];
                                            remaining -= 1;
                                            continue 'loop_;
                                        }
                                    }
                                }
                                if move_to_target {
                                    continue 'dependency_group;
                                }
                                break;
                            } else {
                                // For non-aliased positionals where `get_name()` returns the
                                // version literal (path/URL) rather than the resolved package
                                // name — github/git/tarball URLs and local folder/tarball/link
                                // paths — fall back to matching by the stored value so a
                                // re-run doesn't append a duplicate `"<name>": "<literal>"`
                                // key. Skipped when the user wrote `alias@url`: that form is
                                // an explicit request to key by `alias`, so consolidating into
                                // an existing entry under a different name would silently drop
                                // the alias. `e_string.is_none()` guards so a match in an
                                // earlier dependency list isn't re-counted across iterations.
                                if request.e_string.is_none()
                                    && !request.is_aliased
                                    && (!move_to_target || list == dependency_list)
                                    && (request.version.tag == dependency::Tag::Github
                                        || request.version.tag == dependency::Tag::Git
                                        || request.version.tag == dependency::Tag::Tarball
                                        || request.version.tag == dependency::Tag::Folder
                                        || request.version.tag == dependency::Tag::Symlink)
                                {
                                    for item in query
                                        .expr
                                        .data
                                        .e_object()
                                        .expect("infallible: variant checked")
                                        .properties
                                        .slice()
                                    {
                                        if let Some(v) = &item.value {
                                            let url = request
                                                .version
                                                .literal
                                                .slice(request.version_buf());
                                            if let bun_ast::ExprData::EString(s) = &v.data {
                                                if s.eql_bytes(url) {
                                                    request.e_string = Some(
                                                        v.data
                                                            .e_string()
                                                            .expect("infallible: variant checked")
                                                            .as_ptr(),
                                                    );
                                                    remaining -= 1;
                                                    break 'dependency_group;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                i += 1;
            }
        }
    }

    // `bun update <name>` never adds `<name>`: a name this file does not declare only moves in the lockfile.
    let update_in_place = manager.subcommand == Subcommand::Update;
    if update_in_place {
        remaining -= updates
            .iter()
            .filter(|request| {
                request.e_string.is_none() && request.package_id == INVALID_PACKAGE_ID
            })
            .count();
    }

    if remaining != 0 {
        changed = true;
        let mut new_dependencies: Vec<G::Property> = {
            let mut dependencies: Vec<G::Property> = Vec::new();
            if let Some(query) = current_package_json.as_property(dependency_list) {
                if let bun_ast::ExprData::EObject(obj) = &query.expr.data {
                    for p in obj.properties.slice() {
                        dependencies.push(copy_property(p));
                    }
                }
            }
            let target = dependencies.len() + remaining - replacing;
            while dependencies.len() < target {
                dependencies.push(G::Property::default());
            }
            dependencies
        };

        for request in updates.iter_mut() {
            if request.e_string.is_some()
                || (update_in_place && request.package_id == INVALID_PACKAGE_ID)
            {
                continue;
            }

            let mut k: usize = 0;
            while k < new_dependencies.len() {
                if let Some(key) = &new_dependencies[k].key {
                    let name = request.get_name();
                    if !key
                        .data
                        .e_string()
                        .expect("infallible: variant checked")
                        .eql_bytes(name)
                    {
                        k += 1;
                        continue;
                    }
                    if request.package_id == INVALID_PACKAGE_ID {
                        // Duplicate dependency (e.g., "react" in both "dependencies" and
                        // "optionalDependencies"). Remove the old dependency.
                        new_dependencies[k] = G::Property::default();
                        // Drop the trailing slot (no shift).
                        let new_len = new_dependencies.len() - 1;
                        new_dependencies.truncate(new_len);
                    }
                }

                new_dependencies[k].key = Some(Expr::allocate(
                    arena,
                    E::EString::init(arena_dup(
                        arena,
                        request.get_resolved_name(&manager.lockfile),
                    )),
                    bun_ast::Loc::EMPTY,
                ));

                // Read by the `workspace:` arm of the write-back below. The other arms overwrite
                // it.
                let declared: &[u8] = match new_dependencies[k]
                    .value
                    .as_ref()
                    .and_then(Expr::as_utf8_string_literal)
                {
                    Some(literal) => arena_dup(arena, literal),
                    None => b"",
                };
                new_dependencies[k].value = Some(Expr::allocate(
                    arena,
                    E::EString::init(declared),
                    bun_ast::Loc::EMPTY,
                ));

                request.e_string = Some(
                    new_dependencies[k]
                        .value
                        .as_ref()
                        .unwrap()
                        .data
                        .e_string()
                        .unwrap()
                        .as_ptr(),
                );
                break;
            }

            // For a non-aliased git/github/tarball/folder request, `get_name()` is the
            // URL or path literal: the before-install edit keys its entry by that
            // literal, and the slot above was just re-keyed to the resolved package
            // name. If the list already declared this package under the resolved name
            // with a different literal (e.g. a new commit hash), that stale entry is
            // still present, so drop it or the file ends up with a duplicate key.
            if !request.is_aliased && k < new_dependencies.len() {
                let resolved_name = request.get_resolved_name(&manager.lockfile);
                let mut j = new_dependencies.len();
                while j > 0 {
                    j -= 1;
                    if j == k {
                        continue;
                    }
                    if let Some(key) = &new_dependencies[j].key {
                        if key
                            .data
                            .e_string()
                            .expect("infallible: variant checked")
                            .eql_bytes(resolved_name)
                        {
                            new_dependencies.remove(j);
                            if j < k {
                                k -= 1;
                            }
                        }
                    }
                }
            }

            // There are no early-exit
            // paths between the top of this `for` body and here, so a plain post-loop assert
            // suffices (and avoids a `scopeguard` borrow conflict on
            // `request.e_string`).
            debug_assert!(request.e_string.is_some());
        }

        let mut needs_new_dependency_list = true;
        let mut dependencies_object: Expr = 'brk: {
            if let Some(query) = current_package_json.as_property(dependency_list) {
                if matches!(query.expr.data, bun_ast::ExprData::EObject(_)) {
                    needs_new_dependency_list = false;
                    break 'brk query.expr;
                }
            }

            Expr::allocate(
                arena,
                E::Object {
                    properties: bun_alloc::AstAlloc::vec(),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            )
        };

        {
            let obj = dependencies_object
                .data
                .e_object_mut()
                .expect("infallible: variant checked");
            obj.properties = G::PropertyList::move_from_list(new_dependencies);
            if obj.properties.len_u32() > 1 {
                obj.alphabetize_properties();
            }
        }

        if needs_new_dependency_list {
            let mut root_properties: Vec<G::Property> = match current_package_json.data.e_object() {
                Some(obj) => obj.properties.slice().iter().map(copy_property).collect(),
                None => Vec::new(),
            };
            root_properties.push(G::Property {
                key: Some(Expr::allocate(
                    arena,
                    E::EString::init(arena_dup(arena, dependency_list)),
                    bun_ast::Loc::EMPTY,
                )),
                value: Some(dependencies_object),
                ..Default::default()
            });
            *current_package_json = Expr::allocate(
                arena,
                E::Object {
                    properties: G::PropertyList::move_from_list(root_properties),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );
        }
    }

    let resolutions = if !options.before_install {
        manager.lockfile.packages.items_resolution()
    } else {
        &[]
    };
    for request in updates.iter_mut() {
        if let Some(e_string) = request.e_string {
            // SAFETY: `e_string` is a `*mut E::EString` captured at one of two provenance sites:
            //   (a) the freshly `Expr::allocate`d empty value string in `new_dependencies` (the
            //       `e_string().unwrap().as_ptr()` call inside the `while k < new_dependencies.len()`
            //       loop) — backed by `manager.ast_arena`, which is process-lifetime; or
            //   (b) a pre-existing slot from the parsed `current_package_json` input tree
            //       (`value.expr.data.e_string()` / `v.data.e_string()` in the earlier
            //       dependency-group scan) — backed by the thread-local Expr
            //       Store, which the *caller* guarantees stays live for the duration of `edit`
            //       (it owns the parsed tree).
            // Note: `ExprDisabler::scope()` at function entry is a debug guard that *forbids*
            // Store use, not a keep-alive — it exists precisely so that the (a)-path nodes are
            // never Store-backed. The `*current_package_json = Expr::allocate(...)` reassignments
            // above only overwrite a Copy `Expr` handle; they never reset either arena. The Expr
            // tree references the slot via `StoreRef` (a Copy `NonNull`) and no `&`/`&mut`
            // derived from a `StoreRef` to the same `E::EString` is live inside this loop body,
            // so this is the sole mutable borrow.
            let e_string = unsafe { &mut *e_string };
            // `bun update <pkg>` only moves registry entries. `bun add` replaces any entry.
            if manager.subcommand == Subcommand::Update
                && !literal_tag(e_string.data.slice()).is_npm()
            {
                continue;
            }
            if request.package_id as usize >= resolutions.len()
                || resolutions[request.package_id as usize].tag == resolution::Tag::Uninitialized
            {
                // Either nothing satisfies it, or `picks_latest_tag` handles it later, so it stays
                // as declared.
                if update_to_latest
                    || (manager.subcommand == Subcommand::Update && !options.before_install)
                {
                    continue;
                }
                // The entry `bun update` is updating keeps its alias target whatever gets resolved.
                let existing: Option<&[u8]> = (manager.subcommand == Subcommand::Update
                    && !e_string.is_blank())
                .then(|| e_string.data.slice());
                let requested: &[u8] = request.version.literal.slice(request.version_buf());
                // A bare `bun update <name>` parses as an empty dist-tag; `<name>@<tag>` is an explicit request.
                let explicit_dist_tag =
                    request.version.tag == dependency::Tag::DistTag && !requested.is_empty();
                let mut version_literal: &[u8] = match existing {
                    Some(existing)
                        if request.version.tag != dependency::Tag::Npm && !explicit_dist_tag =>
                    {
                        existing
                    }
                    _ => match request.version.tag {
                        dependency::Tag::Uninitialized => b"latest",
                        _ => requested,
                    },
                };
                if let Some(existing) = existing {
                    version_literal = with_alias_of(arena, existing, version_literal);
                }
                if e_string.data.slice() != version_literal {
                    changed = true;
                    e_string.data = arena_dup(arena, version_literal).into();
                }

                continue;
            }
            let new_literal: &[u8] = match resolutions[request.package_id as usize].tag {
                resolution::Tag::Npm => 'npm: {
                    let installed = request.version.literal.slice(request.version_buf());
                    let resolved = resolutions[request.package_id as usize].npm().version;
                    let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
                    // `bun update <name>` keeps a dist-tag literal as written unless --latest, like the bare path.
                    if manager.subcommand == Subcommand::Update
                        && request.version.tag == dependency::Tag::DistTag
                        && !update_to_latest
                    {
                        break 'npm arena_dup(arena, installed);
                    }
                    if manager.subcommand == Subcommand::Update
                        && matches!(
                            request.version.tag,
                            dependency::Tag::DistTag | dependency::Tag::Npm
                        )
                    {
                        if let Some(entry) = manager.updating_packages.get(request.name) {
                            let original: &[u8] = &entry.original_version_literal;
                            let original = match split_npm_alias(installed) {
                                Some(_) => with_alias_of(
                                    arena,
                                    installed,
                                    split_npm_alias(original)
                                        .map_or(original, |(_, version)| version),
                                ),
                                None => original,
                            };
                            // `--exact` never pins a peer range, as in `edit_update_entries`.
                            let is_peer = request.e_string
                                == string_entry(
                                    current_package_json,
                                    DependencyGroup::PEER.prop,
                                    request.name,
                                )
                                .map(|slot| slot.as_ptr());
                            match updated_version_literal(
                                original,
                                resolved,
                                string_buf,
                                options.exact_versions && !is_peer,
                                update_to_latest,
                            ) {
                                Some(new_version) => break 'npm arena_dup(arena, &new_version),
                                // no explicit `@range`: the row still spells the declared literal, which stays as written
                                None => {
                                    if strings::eql_long(
                                        installed,
                                        &entry.original_version_literal,
                                        true,
                                    ) {
                                        break 'npm arena_dup(arena, installed);
                                    }
                                }
                            }
                        }
                    }
                    // `foo@npm:bar` (no version part) is saved like `foo` would be: `npm:bar@^<resolved>`.
                    let bare_alias =
                        split_npm_alias(installed).is_some_and(|(_, version)| version.is_empty());
                    if request.version.tag == dependency::Tag::DistTag
                        || bare_alias
                        || ((manager.subcommand == Subcommand::Update || options.exact_versions)
                            && request.version.tag == dependency::Tag::Npm
                            && !request.version.npm().version.is_exact())
                    {
                        let mut new_version = Vec::new();
                        write!(
                            &mut new_version,
                            "{}{}",
                            if options.exact_versions { "" } else { "^" },
                            resolved.fmt(string_buf)
                        )
                        .expect("infallible: in-memory write");
                        break 'npm with_alias_of(arena, installed, arena_dup(arena, &new_version));
                    }

                    arena_dup(arena, installed)
                }

                // A range that linked a workspace member has nothing to move to.
                resolution::Tag::Workspace if manager.subcommand == Subcommand::Update => continue,
                // Don't use the bound dependency, because an unchanged resolution keeps the old
                // dependency's literal.
                resolution::Tag::Workspace => match literal_tag(e_string.data.slice()) {
                    dependency::Tag::Workspace => e_string.data.slice(),
                    // An `npm:` alias stays as written. `workspace:*` would look the workspace up
                    // by the entry's key, which is the alias and not the workspace's name.
                    _ if split_npm_alias(e_string.data.slice()).is_some() => e_string.data.slice(),
                    _ => b"workspace:*",
                },
                _ => arena_dup(arena, request.version.literal.slice(request.version_buf())),
            };
            if e_string.data.slice() != new_literal {
                changed = true;
                e_string.data = bun_ast::StoreStr::new(new_literal);
            }
        }
    }
    if move_to_target && dependency_list == DependencyGroup::PEER.prop {
        for request in updates.iter() {
            let name = request.get_resolved_name(&manager.lockfile);
            also_declared.extend(
                string_entry(current_package_json, dependency_list, name).zip(string_entry(
                    current_package_json,
                    DependencyGroup::DEV.prop,
                    name,
                )),
            );
        }
    }
    // `bun add` without a group flag writes the new spec to every non-peer group that declares the
    // package. If this install skips one of those groups, only the entry chosen above is rewritten.
    if !move_to_target && manager.subcommand == Subcommand::Add {
        let features = manager.options.local_package_features;
        for request in updates.iter() {
            let name = request.get_resolved_name(&manager.lockfile);
            let groups = [
                (DependencyGroup::DEPENDENCIES, true),
                (DependencyGroup::DEV, features.dev_dependencies),
                (DependencyGroup::OPTIONAL, features.optional_dependencies),
            ];
            let entry =
                |group: &DependencyGroup| string_entry(current_package_json, group.prop, name);
            if (groups.iter()).any(|(group, followed)| !*followed && entry(group).is_some()) {
                continue;
            }
            let mut declared = groups.iter().filter_map(|(group, _)| entry(group));
            if let Some(slot) = declared
                .next()
                .filter(|slot| request.e_string == Some(slot.as_ptr()))
            {
                also_declared.extend(declared.map(|other| (slot, other)));
            }
        }
    }
    for (slot, mut other) in also_declared {
        if other.data.slice() != slot.data.slice() {
            changed = true;
            other.data = slot.data;
        }
    }
    Ok(changed)
}

const TRUSTED_DEPENDENCIES_STRING: &[u8] = b"trustedDependencies";
