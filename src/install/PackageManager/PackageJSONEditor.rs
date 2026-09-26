use bun_collections::{StringArrayHashMap, VecExt};
use std::io::Write as _;

use bun_ast as js_ast;
use bun_ast::{E, Expr, G};
use bun_core::{Global, Output, strings};
use bun_semver as semver;

use bun_install::dependency::{self, DependencyExt as _, TagExt as _};
use bun_install::lockfile::CatalogMap;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::{Dependency, INVALID_PACKAGE_ID, Lockfile, resolution};
use bun_install_types::{DependencyGroup, PackageNameHash};

use super::package_manager_options::Do;
use super::{
    CatalogUpdateInfo, DetachedVersion, PackageManager, PackageUpdateInfo, Subcommand,
    UpdateRequest,
};

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
fn arena_str<'a>(arena: &'a bun_alloc::Arena, bytes: &[u8]) -> &'a [u8] {
    arena.alloc_slice_copy(bytes)
}
#[inline]
fn arena_dup<'a>(arena: &'a bun_alloc::Arena, bytes: &[u8]) -> &'a [u8] {
    arena.alloc_slice_copy(bytes)
}

/// `npm:@foo/bar@~1.2.3` -> (`npm:@foo/bar`, `~1.2.3`); `npm:foo` -> (`npm:foo`, `""`).
fn split_npm_alias(literal: &[u8]) -> Option<(&[u8], &[u8])> {
    let literal = strings::trim(literal, &strings::WHITESPACE_CHARS);
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
            arena_str(arena, &v)
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
fn updated_version_literal(
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
        None => original_version_literal,
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
    let new_trusted_deps: js_ast::ExprNodeList = {
        let mut deps = vec![Expr::EMPTY; trusted_dependencies.len() + trusted_dependencies_to_add]
            .into_boxed_slice();
        deps[0..trusted_dependencies.len()].copy_from_slice(trusted_dependencies);
        // tail already initialized to Expr::EMPTY by vec!

        for name in &names_to_add[0..len] {
            #[cfg(debug_assertions)]
            {
                let mut has_missing = false;
                for dep in deps.iter() {
                    if matches!(dep.data, bun_ast::ExprData::EMissing(_)) {
                        has_missing = true;
                    }
                }
                debug_assert!(has_missing);
            }

            let mut i = deps.len();
            while i > 0 {
                i -= 1;
                if matches!(deps[i].data, bun_ast::ExprData::EMissing(_)) {
                    deps[i] = Expr::init(E::EString::init(name), bun_ast::Loc::EMPTY);
                    break;
                }
            }
        }

        #[cfg(debug_assertions)]
        for dep in deps.iter() {
            debug_assert!(!matches!(dep.data, bun_ast::ExprData::EMissing(_)));
        }

        js_ast::ExprNodeList::from_owned_slice(deps)
    };

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

    if !matches!(package_json.data, bun_ast::ExprData::EObject(_))
        || package_json
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .len_u32()
            == 0
    {
        let root_properties: Vec<G::Property> = vec![G::Property {
            key: Some(Expr::init(
                E::EString::init(TRUSTED_DEPENDENCIES_STRING),
                bun_ast::Loc::EMPTY,
            )),
            value: Some(trusted_dependencies_array),
            ..Default::default()
        }];

        *package_json = Expr::init(
            E::Object {
                properties: G::PropertyList::move_from_list(root_properties),
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        );
    } else if needs_new_trusted_dependencies_list {
        let obj = package_json
            .data
            .e_object()
            .expect("infallible: variant checked");
        let old_props = obj.properties.slice();
        let mut root_properties: Vec<G::Property> = Vec::with_capacity(old_props.len() + 1);
        for p in old_props {
            root_properties.push(copy_property(p));
        }
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
    edit_update_no_args_in(
        &manager.lockfile,
        &manager.ast_arena,
        &mut manager.updating_packages,
        manager.workspace_name_hash,
        manager.options.do_.contains(Do::UPDATE_TO_LATEST),
        current_package_json,
        options,
    )
}

/// Split-borrow variant: callers holding a `&mut` to another `PackageManager` field can use this.
pub(crate) fn edit_update_no_args_in(
    lockfile: &crate::Lockfile,
    arena: &bun_alloc::Arena,
    updating_packages: &mut StringArrayHashMap<PackageUpdateInfo>,
    workspace_name_hash: Option<PackageNameHash>,
    update_to_latest: bool,
    current_package_json: &mut Expr,
    options: EditOptions,
) -> Result<bool, bun_alloc::AllocError> {
    edit_update_entries(
        lockfile,
        arena,
        updating_packages,
        workspace_name_hash,
        update_to_latest,
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

fn edit_update_entries(
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
        let group_str = group.prop;

        if let Some(mut root) = current_package_json.as_property(group_str) {
            if matches!(root.expr.data, bun_ast::ExprData::EObject(_)) {
                if options.before_install {
                    // set each npm dependency to latest
                    for dep in root
                        .expr
                        .data
                        .e_object_mut()
                        .expect("infallible: variant checked")
                        .properties
                        .slice_mut()
                    {
                        let Some(key) = &dep.key else { continue };
                        if !matches!(key.data, bun_ast::ExprData::EString(_)) {
                            continue;
                        }
                        let Some(value) = &dep.value else { continue };
                        if !matches!(value.data, bun_ast::ExprData::EString(_)) {
                            continue;
                        }

                        let version_literal = value
                            .as_utf8_string_literal()
                            .unwrap_or_else(|| bun_core::out_of_memory());
                        let tag = dependency::Tag::infer(version_literal);

                        // npm ranges only (and dist-tags with --latest); `catalog:` is handled by edit_catalogs_*.
                        if tag != dependency::Tag::Npm
                            && (tag != dependency::Tag::DistTag || !update_to_latest)
                        {
                            continue;
                        }

                        let key_str = key.as_utf8_string_literal().expect("unreachable");
                        if !selected(key_str, version_literal) {
                            continue;
                        }
                        // Capture the literal as an owned
                        // copy before borrowing `updating_packages` mutably.
                        let version_literal_owned = Box::<[u8]>::from(version_literal);
                        let entry = updating_packages.get_or_put(key_str)?;

                        // If a dependency is present in more than one dependency group, only one of it's versions
                        // will be updated. The group is determined by the order of `dependency_groups`, the same
                        // order used to choose which version to install.
                        if entry.found_existing {
                            continue;
                        }

                        *entry.value_ptr = PackageUpdateInfo {
                            original_version_literal: version_literal_owned,
                            ..Default::default()
                        };

                        if update_to_latest {
                            let temp_version = with_alias_of(arena, version_literal, b"latest");
                            if temp_version == version_literal {
                                continue;
                            }
                            changed = true;
                            dep.value = Some(Expr::allocate(
                                arena,
                                E::EString::init(temp_version),
                                bun_ast::Loc::EMPTY,
                            ));
                        }
                    }
                } else {
                    let string_buf = lockfile.buffers.string_bytes.as_slice();
                    let workspace_package_id =
                        lockfile.get_workspace_package_id(workspace_name_hash);
                    let packages = lockfile.packages.slice();
                    let resolutions = packages.items_resolution();
                    let deps = packages.items_dependencies()[workspace_package_id as usize];
                    let resolution_ids =
                        packages.items_resolutions()[workspace_package_id as usize];
                    let workspace_deps: &[Dependency] =
                        deps.get(lockfile.buffers.dependencies.as_slice());
                    let workspace_resolution_ids =
                        resolution_ids.get(lockfile.buffers.resolutions.as_slice());

                    for dep in root
                        .expr
                        .data
                        .e_object_mut()
                        .expect("infallible: variant checked")
                        .properties
                        .slice_mut()
                    {
                        let Some(key) = &dep.key else { continue };
                        if !matches!(key.data, bun_ast::ExprData::EString(_)) {
                            continue;
                        }
                        let Some(value) = &dep.value else { continue };
                        if !matches!(value.data, bun_ast::ExprData::EString(_)) {
                            continue;
                        }

                        // `catalog:` references are never rewritten; the root catalog entry is updated instead.
                        let value_literal = value
                            .as_utf8_string_literal()
                            .unwrap_or_else(|| bun_core::out_of_memory());
                        if dependency::Tag::infer(value_literal) == dependency::Tag::Catalog {
                            continue;
                        }

                        let key_str = key
                            .as_utf8_string_literal()
                            .unwrap_or_else(|| bun_core::out_of_memory());
                        if !selected(key_str, value_literal) {
                            continue;
                        }

                        'updated: {
                            // Only the first dependency group naming the package is rewritten.
                            if let Some(entry) = updating_packages.get_mut(key_str) {
                                if entry.written_back {
                                    break 'updated;
                                }
                                entry.written_back = true;
                                debug_assert_eq!(
                                    workspace_deps.len(),
                                    workspace_resolution_ids.len()
                                );
                                for (workspace_dep, &package_id) in
                                    workspace_deps.iter().zip(workspace_resolution_ids)
                                {
                                    if package_id == INVALID_PACKAGE_ID {
                                        continue;
                                    }

                                    let resolution = &resolutions[package_id as usize];
                                    if resolution.tag != resolution::Tag::Npm {
                                        continue;
                                    }

                                    let workspace_dep_name = workspace_dep.name.slice(string_buf);
                                    if !strings::eql_long(workspace_dep_name, key_str, true) {
                                        continue;
                                    }

                                    let resolved_version = lockfile
                                        .resolve_catalog_dependency(workspace_dep)
                                        .unwrap_or_else(|| workspace_dep.version.clone());
                                    if let Some(npm_version) = resolved_version.try_npm() {
                                        // an exact pin is not moved by a plain `bun update`
                                        if !update_to_latest && npm_version.version.is_exact() {
                                            break 'updated;
                                        }
                                    }

                                    let Some(new_version) = updated_version_literal(
                                        &entry.original_version_literal,
                                        resolution.npm().version,
                                        string_buf,
                                        options.exact_versions,
                                        update_to_latest,
                                    ) else {
                                        break 'updated;
                                    };
                                    if new_version.as_slice() == value_literal {
                                        break 'updated;
                                    }
                                    changed = true;
                                    dep.value = Some(Expr::allocate(
                                        arena,
                                        E::EString::init(arena_str(arena, &new_version)),
                                        bun_ast::Loc::EMPTY,
                                    ));
                                    break 'updated;
                                }
                            }
                        }
                    }
                }
            }
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

/// Records the original version of every catalog entry and, with `--latest`,
/// rewrites each to `latest` in memory so the resolver fetches it.
pub(crate) fn edit_catalogs_before_update(
    manager: &mut PackageManager,
    root_package_json: &Expr,
) -> Result<bool, bun_alloc::AllocError> {
    // see note in `edit_update_no_args` — always avoid the store
    let _guard = ExprDisabler::scope();

    debug_assert!(manager.updating_catalogs.is_empty());

    let update_to_latest = manager.options.do_.contains(Do::UPDATE_TO_LATEST);

    let arena = &manager.ast_arena;
    let updating_catalogs = &mut manager.updating_catalogs;

    for_each_catalog_object(root_package_json, |catalog_name, mut catalog_expr| {
        if !matches!(catalog_expr.data, bun_ast::ExprData::EObject(_)) {
            return Ok(());
        }
        for dep in catalog_expr
            .data
            .e_object_mut()
            .expect("infallible: variant checked")
            .properties
            .slice_mut()
        {
            let Some(key) = &dep.key else { continue };
            if !matches!(key.data, bun_ast::ExprData::EString(_)) {
                continue;
            }
            let Some(value) = &dep.value else { continue };
            if !matches!(value.data, bun_ast::ExprData::EString(_)) {
                continue;
            }

            let version_literal = value
                .as_utf8_string_literal()
                .unwrap_or_else(|| bun_core::out_of_memory());
            let tag = dependency::Tag::infer(version_literal);

            // same tag rule as direct dependencies
            if tag != dependency::Tag::Npm && (tag != dependency::Tag::DistTag || !update_to_latest)
            {
                continue;
            }

            let key_str = key
                .as_utf8_string_literal()
                .unwrap_or_else(|| bun_core::out_of_memory());

            updating_catalogs.push(CatalogUpdateInfo {
                catalog_name: Box::from(catalog_name),
                dep_name: Box::from(key_str),
                original_version_literal: Box::from(version_literal),
                new_version_literal: None,
                original: None,
            });

            if update_to_latest {
                let temp_version = with_alias_of(arena, version_literal, b"latest");
                dep.value = Some(Expr::allocate(
                    arena,
                    E::EString::init(temp_version),
                    bun_ast::Loc::EMPTY,
                ));
            }
        }
        Ok(())
    })?;

    Ok(!manager.updating_catalogs.is_empty())
}

/// Runs on the loaded lockfile, before the differ: every `catalog:` row of an entry recorded by `edit_catalogs_before_update` gives the entry the version it was locked to (the first row of the entry wins) and registers its name in `updating_packages` the way the cwd's own dependency lists register theirs, so the install summary prints the entry's move as an update row; a name those lists already registered keeps their original.
pub(crate) fn record_catalog_originals(
    manager: &mut PackageManager,
) -> Result<(), bun_alloc::AllocError> {
    if manager.updating_catalogs.is_empty() {
        return Ok(());
    }
    let lockfile: &Lockfile = &manager.lockfile;
    let infos: &mut [CatalogUpdateInfo] = &mut manager.updating_catalogs;
    let updating_packages = &mut manager.updating_packages;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let package_resolutions = lockfile.packages.items_resolution();

    for (dep, &package_id) in lockfile
        .buffers
        .dependencies
        .iter()
        .zip(lockfile.buffers.resolutions.iter())
    {
        if dep.version.tag != dependency::Tag::Catalog
            || (package_id as usize) >= package_resolutions.len()
        {
            continue;
        }
        let resolution = &package_resolutions[package_id as usize];
        if resolution.tag != resolution::Tag::Npm {
            continue;
        }
        let dep_name = dep.name.slice(string_buf);
        let catalog_name = dep.version.catalog().slice(string_buf);
        let Some(info) =
            CatalogUpdateInfo::position(infos, catalog_name, dep_name).map(|i| &mut infos[i])
        else {
            continue;
        };
        let version = resolution.npm().version;
        if info.original.is_none() {
            info.original = Some(DetachedVersion::new(version, string_buf));
        }
        let entry = updating_packages.get_or_put(dep_name)?;
        if entry.found_existing {
            continue;
        }
        *entry.value_ptr = PackageUpdateInfo {
            original_version_literal: info.original_version_literal.clone(),
            // The entry is written by `edit_catalogs_after_update`; `edit_update_entries` has nothing of it to write into the cwd's dependency lists.
            written_back: true,
            catalog_entry: true,
            ..Default::default()
        };
        entry.value_ptr.set_original_version(version, string_buf);
    }
    Ok(())
}

/// Writes each recorded catalog entry's resolved literal (unresolved ones are restored) into the root AST; returns `changed`.
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
    for_each_catalog_object(root_package_json, |catalog_name, mut catalog_expr| {
        if !matches!(catalog_expr.data, bun_ast::ExprData::EObject(_)) {
            return Ok(());
        }
        for dep in catalog_expr
            .data
            .e_object_mut()
            .expect("infallible: variant checked")
            .properties
            .slice_mut()
        {
            let Some(key) = &dep.key else { continue };
            if !matches!(key.data, bun_ast::ExprData::EString(_)) {
                continue;
            }
            let key_str = key
                .as_utf8_string_literal()
                .unwrap_or_else(|| bun_core::out_of_memory());

            let Some(info) = index
                .candidates(key_str)
                .and_then(|candidates| CatalogInfoIndex::pick(candidates, &infos, catalog_name))
                .map(|i| &infos[i])
            else {
                continue;
            };

            let new_literal: &[u8] = arena_str(
                arena,
                info.new_version_literal
                    .as_deref()
                    .unwrap_or(&info.original_version_literal),
            );

            changed |= !strings::eql_long(new_literal, &info.original_version_literal, true);

            dep.value = Some(Expr::allocate(
                arena,
                E::EString::init(new_literal),
                bun_ast::Loc::EMPTY,
            ));
        }
        Ok(())
    })?;

    // The install summary still reads the entries' originals.
    manager.updating_catalogs = infos;
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

    fn candidates(&self, dep_name: &[u8]) -> Option<&[usize]> {
        self.0.get(dep_name).map(Vec::as_slice)
    }

    /// An entry spelled exactly like `catalog_name` wins over the `catalog:` / `catalog:default` equivalence.
    fn pick(
        candidates: &[usize],
        infos: &[CatalogUpdateInfo],
        catalog_name: &[u8],
    ) -> Option<usize> {
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
        if dep.version.tag != dependency::Tag::Catalog {
            continue;
        }
        if package_id == INVALID_PACKAGE_ID {
            continue;
        }

        let Some(candidates) = by_name.candidates(dep.name.slice(string_buf)) else {
            continue;
        };
        if candidates
            .iter()
            .all(|&i| infos[i].new_version_literal.is_some())
        {
            continue;
        }
        let catalog_name = dep.version.catalog().slice(string_buf);
        let Some(index) = CatalogInfoIndex::pick(candidates, infos, catalog_name) else {
            continue;
        };
        if infos[index].new_version_literal.is_some() {
            continue;
        }

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
                (bstr::BStr::new(request.version_buf()),),
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
                // order-insensitive scan: `FOUR` is fine here
                'dependency_group: for list in DependencyGroup::FOUR.map(|g| g.prop) {
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
                                                dependency::Tag::infer(version_literal)
                                                    == dependency::Tag::Catalog
                                            },
                                        );

                                    // `bun update <name>` edits the slot in place; the rebuild below re-sorts the keys.
                                    if request.package_id != INVALID_PACKAGE_ID
                                        && manager.subcommand != Subcommand::Update
                                        && strings::eql_long(list, dependency_list, true)
                                        && !keep_catalog_reference
                                    {
                                        replacing += 1;
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
                                                let tag = dependency::Tag::infer(version_literal);

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

                new_dependencies[k].value = Some(Expr::allocate(
                    arena,
                    // we set it later
                    E::EString::init(b""),
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

        if !matches!(current_package_json.data, bun_ast::ExprData::EObject(_))
            || current_package_json
                .data
                .e_object()
                .expect("infallible: variant checked")
                .properties
                .len_u32()
                == 0
        {
            let root_properties: Vec<G::Property> = vec![G::Property {
                key: Some(Expr::allocate(
                    arena,
                    E::EString::init(arena_dup(arena, dependency_list)),
                    bun_ast::Loc::EMPTY,
                )),
                value: Some(dependencies_object),
                ..Default::default()
            }];

            *current_package_json = Expr::allocate(
                arena,
                E::Object {
                    properties: G::PropertyList::move_from_list(root_properties),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );
        } else if needs_new_dependency_list {
            let obj = current_package_json
                .data
                .e_object()
                .expect("infallible: variant checked");
            let old_props = obj.properties.slice();
            let mut root_properties: Vec<G::Property> = Vec::with_capacity(old_props.len() + 1);
            for p in old_props {
                root_properties.push(copy_property(p));
            }
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
            // `bun update <pkg>` keeps a `catalog:` reference; `bun add` still replaces it.
            if manager.subcommand == Subcommand::Update
                && dependency::Tag::infer(e_string.data.slice()) == dependency::Tag::Catalog
            {
                continue;
            }
            if request.package_id as usize >= resolutions.len()
                || resolutions[request.package_id as usize].tag == resolution::Tag::Uninitialized
            {
                // The entry `bun update` is updating keeps its alias target whatever gets resolved.
                let existing: Option<&[u8]> = (manager.subcommand == Subcommand::Update
                    && options.before_install
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
                if update_to_latest {
                    version_literal = with_alias_of(arena, version_literal, b"latest");
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
                            match updated_version_literal(
                                original,
                                resolved,
                                string_buf,
                                options.exact_versions,
                                update_to_latest,
                            ) {
                                Some(new_version) => break 'npm arena_str(arena, &new_version),
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
                        || (manager.subcommand == Subcommand::Update
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
                        break 'npm with_alias_of(arena, installed, arena_str(arena, &new_version));
                    }

                    arena_dup(arena, installed)
                }

                resolution::Tag::Workspace => b"workspace:*",
                _ => arena_dup(arena, request.version.literal.slice(request.version_buf())),
            };
            if e_string.data.slice() != new_literal {
                changed = true;
                e_string.data = bun_ast::StoreStr::new(new_literal);
            }
        }
    }
    Ok(changed)
}

const TRUSTED_DEPENDENCIES_STRING: &[u8] = b"trustedDependencies";
