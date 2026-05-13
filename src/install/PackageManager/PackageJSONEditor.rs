use bun_collections::VecExt;
use std::io::Write as _;

use bun_ast as js_ast;
use bun_ast::{E, Expr, G};
use bun_core::strings;
use bun_semver as semver;

use bun_install::dependency::{self, TagExt as _};
use bun_install::lockfile::package::{PackageColumns as _};
use bun_install::{Dependency, INVALID_PACKAGE_ID, resolution};
use bun_install_types::DependencyGroup;

use super::package_manager_options::{Do, Enable};
use super::{PackageManager, PackageUpdateInfo, Subcommand, UpdateRequest};

type ExprDisabler = bun_ast::expr::Disabler;

const DEPENDENCY_GROUPS: [DependencyGroup; 4] = [
    DependencyGroup::OPTIONAL,
    DependencyGroup::DEV,
    DependencyGroup::DEPENDENCIES,
    DependencyGroup::PEER,
];

#[derive(Default, Clone, Copy)]
pub struct EditOptions {
    pub exact_versions: bool,
    pub add_trusted_dependencies: bool,
    pub before_install: bool,
}

/// Allocate a `'static` byte buffer for storage in `E::EString.data`. Zig's
/// equivalent (`allocator.dupe(u8, ...)`) used `manager.allocator`, a
/// process-lifetime arena that is never reset during a `bun pm pkg`/`bun add`
/// invocation — so this ownership is parked for the rest of the command, not
/// reclaimed. `heap::release` is the named spelling of that hand-off.
#[inline]
fn leak_str(bytes: Vec<u8>) -> &'static [u8] {
    bun_core::heap::release(bytes.into_boxed_slice())
}
#[inline]
fn leak_dup(bytes: &[u8]) -> &'static [u8] {
    bun_core::heap::release(Box::<[u8]>::from(bytes))
}

/// Shallow-copy a `G::Property` for the JSON-editing path. Only `key`/`value`
/// (both `Option<Expr>`, `Copy`) are populated by the JSON parser; the rest
/// (`ts_decorators`, `class_static_block`, …) are always default for parsed
/// `package.json` and would be discarded by Zig's bitwise `@memcpy` + arena
/// reset anyway.
#[inline]
fn copy_property(p: &G::Property) -> G::Property {
    G::Property {
        key: p.key,
        value: p.value,
        ..G::Property::default()
    }
}

pub fn edit_patched_dependencies(
    _manager: &mut PackageManager,
    package_json: &mut Expr,
    patch_key: &[u8],
    patchfile_path: &[u8],
) -> Result<(), bun_alloc::AllocError> {
    let bump = bun_alloc::Arena::new();
    // const pkg_to_patch = manager.
    let mut patched_dependencies = E::Object::default();
    if let Some(query) = package_json.as_property(b"patchedDependencies") {
        if let bun_ast::ExprData::EObject(obj) = &query.expr.data {
            // Zig dereferences `query.expr.data.e_object.*` to bit-copy the whole
            // E.Object — preserve the formatting fields so the printed
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
        E::EString::init(leak_dup(patchfile_path)),
        bun_ast::Loc::EMPTY,
    );

    patched_dependencies.put(&bump, leak_dup(patch_key), patchfile_expr)?;

    package_json.data.e_object_mut().unwrap().put(
        &bump,
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

    let original_trusted_dependencies: Vec<Expr> = 'brk: {
        if let Some(query) = package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
            if let bun_ast::ExprData::EArray(arr) = &query.expr.data {
                break 'brk arr.items.slice().to_vec();
            }
        }
        Vec::new()
    };

    for i in 0..names_to_add.len() {
        let name = &names_to_add[i];
        for item in original_trusted_dependencies.iter() {
            if let bun_ast::ExprData::EString(s) = &item.data {
                if s.eql_bytes(name) {
                    names_to_add.swap(i, len - 1);
                    len -= 1;
                    break;
                }
            }
        }
    }

    let mut trusted_dependencies: &[Expr] = &[];
    if let Some(query) = package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
        if let bun_ast::ExprData::EArray(arr) = &query.expr.data {
            // SAFETY: `arr` is a `StoreRef` into the AST arena which outlives
            // this function; lifetime erased per Phase-A `Str` convention.
            trusted_dependencies = unsafe { bun_ptr::detach_lifetime(arr.items.slice()) };
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
                    deps[i] = Expr::init(E::EString::init(leak_dup(name)), bun_ast::Loc::EMPTY);
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
        let mut root_properties: Vec<G::Property> = Vec::with_capacity(1);
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
/// versions.
pub fn edit_update_no_args(
    manager: &mut PackageManager,
    current_package_json: &mut Expr,
    options: EditOptions,
) -> Result<(), bun_alloc::AllocError> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    let _guard = ExprDisabler::scope();

    // Zig: `const allocator = manager.allocator;` — process-lifetime arena for AST
    // nodes that must outlive `Expr.Data.Store.reset()`. See `PackageManager.ast_arena`.
    // PORT NOTE: reshaped for borrowck — `arena` is a disjoint-field borrow held across
    // the `&mut manager.updating_packages` accesses below.
    let arena = &manager.ast_arena;

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
                        let mut tag = dependency::Tag::infer(version_literal);

                        // only updating dependencies with npm versions, dist-tags if `--latest`, and catalog versions.
                        if tag != dependency::Tag::Npm
                            && (tag != dependency::Tag::DistTag
                                || !manager.options.do_.contains(Do::UPDATE_TO_LATEST))
                            && tag != dependency::Tag::Catalog
                        {
                            continue;
                        }

                        let mut alias_at_index: Option<usize> = None;
                        if strings::trim(version_literal, &strings::WHITESPACE_CHARS)
                            .starts_with(b"npm:")
                        {
                            // negative because the real package might have a scope
                            // e.g. "dep": "npm:@foo/bar@1.2.3"
                            if let Some(at_index) =
                                strings::last_index_of_char(version_literal, b'@')
                            {
                                tag = dependency::Tag::infer(&version_literal[at_index + 1..]);
                                if tag != dependency::Tag::Npm
                                    && (tag != dependency::Tag::DistTag
                                        || !manager.options.do_.contains(Do::UPDATE_TO_LATEST))
                                    && tag != dependency::Tag::Catalog
                                {
                                    continue;
                                }
                                alias_at_index = Some(at_index);
                            }
                        }

                        let key_str = key.as_utf8_string_literal().expect("unreachable");
                        // PORT NOTE: reshaped for borrowck — capture the literal as an owned
                        // copy before borrowing `manager.updating_packages` mutably.
                        let version_literal_owned = Box::<[u8]>::from(version_literal);
                        let entry = manager.updating_packages.get_or_put(key_str)?;

                        // If a dependency is present in more than one dependency group, only one of it's versions
                        // will be updated. The group is determined by the order of `dependency_groups`, the same
                        // order used to choose which version to install.
                        if entry.found_existing {
                            continue;
                        }

                        *entry.value_ptr = PackageUpdateInfo {
                            original_version_literal: version_literal_owned,
                            is_alias: alias_at_index.is_some(),
                            original_version_string_buf: Box::default(),
                            original_version: None,
                        };

                        if manager.options.do_.contains(Do::UPDATE_TO_LATEST) {
                            // is it an aliased package
                            let temp_version: &'static [u8] = if let Some(at_index) = alias_at_index
                            {
                                let mut v = Vec::new();
                                write!(
                                    &mut v,
                                    "{}@latest",
                                    bstr::BStr::new(&version_literal[0..at_index])
                                )
                                .unwrap();
                                leak_str(v)
                            } else {
                                b"latest"
                            };

                            dep.value = Some(Expr::allocate(
                                arena,
                                E::EString::init(temp_version),
                                bun_ast::Loc::EMPTY,
                            ));
                        }
                    }
                } else {
                    let lockfile = &*manager.lockfile;
                    let string_buf = lockfile.buffers.string_bytes.as_slice();
                    let workspace_package_id =
                        lockfile.get_workspace_package_id(manager.workspace_name_hash);
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

                        let key_str = key
                            .as_utf8_string_literal()
                            .unwrap_or_else(|| bun_core::out_of_memory());

                        'updated: {
                            // fetchSwapRemove because we want to update the first dependency with a matching
                            // name, or none at all
                            if let Some(entry) =
                                manager.updating_packages.fetch_swap_remove(key_str)
                            {
                                let is_alias = entry.value.is_alias;
                                let dep_name = &*entry.key;
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
                                    if !strings::eql_long(workspace_dep_name, dep_name, true) {
                                        continue;
                                    }

                                    let resolved_version = lockfile
                                        .resolve_catalog_dependency(workspace_dep)
                                        .unwrap_or_else(|| workspace_dep.version.clone());
                                    if let Some(npm_version) = resolved_version.try_npm() {
                                        // It's possible we inserted a dependency that won't update (version is an exact version).
                                        // If we find one, skip to keep the original version literal.
                                        if !manager.options.do_.contains(Do::UPDATE_TO_LATEST)
                                            && npm_version.version.is_exact()
                                        {
                                            break 'updated;
                                        }
                                    }

                                    let new_version: Vec<u8> = 'new_version: {
                                        // `resolution.tag == Npm` checked above.
                                        let version_fmt = resolution.npm().version.fmt(string_buf);
                                        if options.exact_versions {
                                            let mut v = Vec::new();
                                            write!(&mut v, "{}", version_fmt)
                                                .expect("infallible: in-memory write");
                                            break 'new_version v;
                                        }

                                        let version_literal: &[u8] = 'version_literal: {
                                            if !is_alias {
                                                break 'version_literal &entry
                                                    .value
                                                    .original_version_literal;
                                            }
                                            if let Some(at_index) = strings::last_index_of_char(
                                                &entry.value.original_version_literal,
                                                b'@',
                                            ) {
                                                break 'version_literal &entry
                                                    .value
                                                    .original_version_literal[at_index + 1..];
                                            }
                                            &entry.value.original_version_literal
                                        };

                                        let pinned_version =
                                            semver::Version::which_version_is_pinned(
                                                version_literal,
                                            );
                                        let mut v = Vec::new();
                                        match pinned_version {
                                            semver::PinnedVersion::Patch => {
                                                write!(&mut v, "{}", version_fmt)
                                                    .expect("infallible: in-memory write")
                                            }
                                            semver::PinnedVersion::Minor => {
                                                write!(&mut v, "~{}", version_fmt)
                                                    .expect("infallible: in-memory write")
                                            }
                                            semver::PinnedVersion::Major => {
                                                write!(&mut v, "^{}", version_fmt)
                                                    .expect("infallible: in-memory write")
                                            }
                                        }
                                        v
                                    };

                                    if is_alias {
                                        let dep_literal =
                                            workspace_dep.version.literal.slice(string_buf);

                                        // negative because the real package might have a scope
                                        // e.g. "dep": "npm:@foo/bar@1.2.3"
                                        if let Some(at_index) =
                                            strings::last_index_of_char(dep_literal, b'@')
                                        {
                                            let mut v = Vec::new();
                                            write!(
                                                &mut v,
                                                "{}@{}",
                                                bstr::BStr::new(&dep_literal[0..at_index]),
                                                bstr::BStr::new(&new_version)
                                            )
                                            .unwrap();
                                            dep.value = Some(Expr::allocate(
                                                arena,
                                                E::EString::init(leak_str(v)),
                                                bun_ast::Loc::EMPTY,
                                            ));
                                            break 'updated;
                                        }

                                        // fallthrough and replace entire version.
                                    }

                                    dep.value = Some(Expr::allocate(
                                        arena,
                                        E::EString::init(leak_str(new_version)),
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
    Ok(())
}

/// edits dependencies and trusted dependencies
/// if options.add_trusted_dependencies is true, gets list from PackageManager.trusted_deps_to_add_to_package_json
pub fn edit(
    manager: &mut PackageManager,
    // Zig `*[]UpdateRequest` — pointer-to-slice whose `.len` is shrunk in place.
    updates: &mut &mut [UpdateRequest],
    current_package_json: &mut Expr,
    dependency_list: &[u8],
    options: EditOptions,
) -> Result<(), bun_alloc::AllocError> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    let _guard = ExprDisabler::scope();

    // Zig: `const allocator = manager.allocator;` — process-lifetime arena for AST
    // nodes that must outlive `Expr.Data.Store.reset()`. See `PackageManager.ast_arena`.
    // PORT NOTE: reshaped for borrowck — `arena` is a disjoint-field borrow held across
    // the `&mut manager.{updating_packages,trusted_deps_to_add_to_package_json}` accesses below.
    let arena = &manager.ast_arena;

    let mut remaining = updates.len();
    let mut replacing: usize = 0;
    let only_add_missing = manager.options.enable.contains(Enable::ONLY_MISSING);

    // There are three possible scenarios here
    // 1. There is no "dependencies" (or equivalent list) or it is empty
    // 2. There is a "dependencies" (or equivalent list), but the package name already exists in a separate list
    // 3. There is a "dependencies" (or equivalent list), and the package name exists in multiple lists
    // Try to use the existing spot in the dependencies list if possible
    {
        let original_trusted_dependencies: Vec<Expr> = 'brk: {
            if !options.add_trusted_dependencies {
                break 'brk Vec::new();
            }
            if let Some(query) = current_package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
                if let bun_ast::ExprData::EArray(arr) = &query.expr.data {
                    // not modifying
                    break 'brk arr.items.slice().to_vec();
                }
            }
            Vec::new()
        };

        if options.add_trusted_dependencies {
            // Iterate backwards to avoid index issues when removing items
            let mut i: usize = manager.trusted_deps_to_add_to_package_json.len();
            while i > 0 {
                i -= 1;
                let trusted_package_name = &manager.trusted_deps_to_add_to_package_json[i];
                for item in original_trusted_dependencies.iter() {
                    if let bun_ast::ExprData::EString(s) = &item.data {
                        if s.eql_bytes(trusted_package_name) {
                            // PORT NOTE: reshaped for borrowck — drop return value (was allocator.free)
                            let _ = manager.trusted_deps_to_add_to_package_json.swap_remove(i);
                            break;
                        }
                    }
                }
            }
        }
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
                                    if request.package_id != INVALID_PACKAGE_ID
                                        && strings::eql_long(list, dependency_list, true)
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
                                                let mut tag =
                                                    dependency::Tag::infer(version_literal);

                                                if tag != dependency::Tag::Npm
                                                    && tag != dependency::Tag::DistTag
                                                {
                                                    break 'add_packages_to_update;
                                                }

                                                // PORT NOTE: reshaped for borrowck — capture an
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

                                                // PORT NOTE: Zig leaves `entry.value_ptr.*`
                                                // undefined across the `npm:`-alias bailout
                                                // below (Zig:435), which is later read by
                                                // `fetchSwapRemove` — UB. `get_or_put` here
                                                // already default-initializes the slot, so
                                                // `found_existing` semantics match Zig and the
                                                // bailout path is well-defined.
                                                let mut is_alias = false;
                                                if strings::trim(
                                                    &version_literal_owned,
                                                    &strings::WHITESPACE_CHARS,
                                                )
                                                .starts_with(b"npm:")
                                                {
                                                    if let Some(at_index) =
                                                        strings::last_index_of_char(
                                                            &version_literal_owned,
                                                            b'@',
                                                        )
                                                    {
                                                        tag = dependency::Tag::infer(
                                                            &version_literal_owned[at_index + 1..],
                                                        );
                                                        if tag != dependency::Tag::Npm
                                                            && tag != dependency::Tag::DistTag
                                                        {
                                                            break 'add_packages_to_update;
                                                        }
                                                        is_alias = true;
                                                    }
                                                }

                                                *entry.value_ptr = PackageUpdateInfo {
                                                    original_version_literal: version_literal_owned,
                                                    is_alias,
                                                    original_version_string_buf: Box::default(),
                                                    original_version: None,
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
                                            // Zig: `updates.*.len -= 1;` — shrink the slice header.
                                            *updates = &mut core::mem::take(updates)[..last];
                                            remaining -= 1;
                                            continue 'loop_;
                                        }
                                    }
                                }
                                break;
                            } else {
                                if request.version.tag == dependency::Tag::Github
                                    || request.version.tag == dependency::Tag::Git
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

    if remaining != 0 {
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

        let mut trusted_dependencies: &[Expr] = &[];
        if options.add_trusted_dependencies {
            if let Some(query) = current_package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
                if let bun_ast::ExprData::EArray(arr) = &query.expr.data {
                    // SAFETY: arena-backed slice; see note in `edit_trusted_dependencies`.
                    trusted_dependencies = unsafe { bun_ptr::detach_lifetime(arr.items.slice()) };
                }
            }
        }

        let trusted_dependencies_to_add = manager.trusted_deps_to_add_to_package_json.len();
        let new_trusted_deps: js_ast::ExprNodeList = 'brk: {
            if !options.add_trusted_dependencies || trusted_dependencies_to_add == 0 {
                break 'brk bun_alloc::AstAlloc::vec();
            }

            let mut deps =
                vec![Expr::EMPTY; trusted_dependencies.len() + trusted_dependencies_to_add]
                    .into_boxed_slice();
            deps[0..trusted_dependencies.len()].copy_from_slice(trusted_dependencies);
            // tail already initialized to Expr::EMPTY

            for package_name in &manager.trusted_deps_to_add_to_package_json {
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
                        deps[i] = Expr::allocate(
                            arena,
                            E::EString::init(leak_dup(package_name)),
                            bun_ast::Loc::EMPTY,
                        );
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

        for request in updates.iter_mut() {
            if request.e_string.is_some() {
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
                        // Zig: `items.len -= 1` (no shift) — drop the trailing slot.
                        let new_len = new_dependencies.len() - 1;
                        new_dependencies.truncate(new_len);
                    }
                }

                new_dependencies[k].key = Some(Expr::allocate(
                    arena,
                    E::EString::init(leak_dup(request.get_resolved_name(&manager.lockfile))),
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

            // Zig:545 `defer ... bun.assert(request.e_string != null)` — there are no early-exit
            // paths between the top of this `for` body and here, so a plain post-loop assert is
            // equivalent to the deferred one (and avoids a `scopeguard` borrow conflict on
            // `request.e_string`).
            #[cfg(debug_assertions)]
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

        let mut needs_new_trusted_dependencies_list = true;
        let mut trusted_dependencies_array: Expr = 'brk: {
            if !options.add_trusted_dependencies || trusted_dependencies_to_add == 0 {
                needs_new_trusted_dependencies_list = false;
                break 'brk Expr::EMPTY;
            }
            if let Some(query) = current_package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
                if matches!(query.expr.data, bun_ast::ExprData::EArray(_)) {
                    needs_new_trusted_dependencies_list = false;
                    break 'brk query.expr;
                }
            }

            Expr::allocate(
                arena,
                E::Array {
                    items: js_ast::ExprNodeList::from_slice(new_trusted_deps.slice()),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            )
        };

        if options.add_trusted_dependencies && trusted_dependencies_to_add > 0 {
            let arr = trusted_dependencies_array
                .data
                .e_array_mut()
                .expect("infallible: variant checked");
            arr.items = new_trusted_deps;
            if arr.items.len_u32() > 1 {
                arr.alphabetize_strings();
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
            let n = if options.add_trusted_dependencies {
                2
            } else {
                1
            };
            let mut root_properties: Vec<G::Property> = Vec::with_capacity(n);
            root_properties.push(G::Property {
                key: Some(Expr::allocate(
                    arena,
                    E::EString::init(leak_dup(dependency_list)),
                    bun_ast::Loc::EMPTY,
                )),
                value: Some(dependencies_object),
                ..Default::default()
            });

            if options.add_trusted_dependencies {
                root_properties.push(G::Property {
                    key: Some(Expr::allocate(
                        arena,
                        E::EString::init(TRUSTED_DEPENDENCIES_STRING),
                        bun_ast::Loc::EMPTY,
                    )),
                    value: Some(trusted_dependencies_array),
                    ..Default::default()
                });
            }

            *current_package_json = Expr::allocate(
                arena,
                E::Object {
                    properties: G::PropertyList::move_from_list(root_properties),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );
        } else {
            if needs_new_dependency_list && needs_new_trusted_dependencies_list {
                let obj = current_package_json
                    .data
                    .e_object()
                    .expect("infallible: variant checked");
                let old_props = obj.properties.slice();
                let mut root_properties: Vec<G::Property> = Vec::with_capacity(old_props.len() + 2);
                for p in old_props {
                    root_properties.push(copy_property(p));
                }
                root_properties.push(G::Property {
                    key: Some(Expr::allocate(
                        arena,
                        E::EString::init(leak_dup(dependency_list)),
                        bun_ast::Loc::EMPTY,
                    )),
                    value: Some(dependencies_object),
                    ..Default::default()
                });
                root_properties.push(G::Property {
                    key: Some(Expr::allocate(
                        arena,
                        E::EString::init(TRUSTED_DEPENDENCIES_STRING),
                        bun_ast::Loc::EMPTY,
                    )),
                    value: Some(trusted_dependencies_array),
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
            } else if needs_new_dependency_list || needs_new_trusted_dependencies_list {
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
                        E::EString::init(if needs_new_dependency_list {
                            leak_dup(dependency_list)
                        } else {
                            TRUSTED_DEPENDENCIES_STRING
                        }),
                        bun_ast::Loc::EMPTY,
                    )),
                    value: Some(if needs_new_dependency_list {
                        dependencies_object
                    } else {
                        trusted_dependencies_array
                    }),
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
            //       dependency-group scan; Zig:447 / Zig:467) — backed by the thread-local Expr
            //       Store, which the *caller* guarantees stays live for the duration of `edit`
            //       (it owns the parsed tree).
            // Note: `ExprDisabler::scope()` at function entry is a debug guard that *forbids*
            // Store use, not a keep-alive — it exists precisely so that the (a)-path nodes are
            // never Store-backed. The `*current_package_json = Expr::allocate(...)` reassignments
            // above only overwrite a Copy `Expr` handle; they never reset either arena. The Expr
            // tree references the slot via `StoreRef` (a Copy `NonNull`) and no `&`/`&mut`
            // derived from a `StoreRef` to the same `E::EString` is live inside this loop body,
            // so this is the sole mutable borrow — matches the Zig original which stores
            // `?*E.String` for this deferred-write pattern.
            let e_string = unsafe { &mut *e_string };
            if request.package_id as usize >= resolutions.len()
                || resolutions[request.package_id as usize].tag == resolution::Tag::Uninitialized
            {
                e_string.data = 'uninitialized: {
                    if manager.subcommand == Subcommand::Update
                        && manager.options.do_.contains(Do::UPDATE_TO_LATEST)
                    {
                        break 'uninitialized b"latest".into();
                    }

                    if manager.subcommand != Subcommand::Update
                        || !options.before_install
                        || e_string.is_blank()
                        || request.version.tag == dependency::Tag::Npm
                    {
                        break 'uninitialized match request.version.tag {
                            dependency::Tag::Uninitialized => b"latest".into(),
                            _ => leak_dup(request.version.literal.slice(request.version_buf()))
                                .into(),
                        };
                    } else {
                        break 'uninitialized e_string.data;
                    }
                };

                continue;
            }
            e_string.data =
                bun_ast::StoreStr::new(match resolutions[request.package_id as usize].tag {
                    resolution::Tag::Npm => 'npm: {
                        if manager.subcommand == Subcommand::Update
                            && (request.version.tag == dependency::Tag::DistTag
                                || request.version.tag == dependency::Tag::Npm)
                        {
                            if let Some(entry) =
                                manager.updating_packages.fetch_swap_remove(request.name)
                            {
                                // Zig declares `alias_at_index` here and assigns it inside the
                                // `version_literal` block but never reads it afterwards (dead
                                // store, vestigial from the earlier `editUpdateNoArgs` copy).
                                // The Rust port omits the variable entirely.
                                let new_version: Vec<u8> = 'new_version: {
                                    let version_fmt = resolutions[request.package_id as usize]
                                        .npm()
                                        .version
                                        .fmt(manager.lockfile.buffers.string_bytes.as_slice());
                                    if options.exact_versions {
                                        let mut v = Vec::new();
                                        write!(&mut v, "{}", version_fmt)
                                            .expect("infallible: in-memory write");
                                        break 'new_version v;
                                    }

                                    let version_literal: &[u8] = 'version_literal: {
                                        if !entry.value.is_alias {
                                            break 'version_literal &entry
                                                .value
                                                .original_version_literal;
                                        }
                                        if let Some(at_index) = strings::last_index_of_char(
                                            &entry.value.original_version_literal,
                                            b'@',
                                        ) {
                                            break 'version_literal &entry
                                                .value
                                                .original_version_literal[at_index + 1..];
                                        }

                                        &entry.value.original_version_literal
                                    };

                                    let pinned_version =
                                        semver::Version::which_version_is_pinned(version_literal);
                                    let mut v = Vec::new();
                                    match pinned_version {
                                        semver::PinnedVersion::Patch => {
                                            write!(&mut v, "{}", version_fmt)
                                                .expect("infallible: in-memory write")
                                        }
                                        semver::PinnedVersion::Minor => {
                                            write!(&mut v, "~{}", version_fmt)
                                                .expect("infallible: in-memory write")
                                        }
                                        semver::PinnedVersion::Major => {
                                            write!(&mut v, "^{}", version_fmt)
                                                .expect("infallible: in-memory write")
                                        }
                                    }
                                    v
                                };

                                if entry.value.is_alias {
                                    let dep_literal = &entry.value.original_version_literal;

                                    if let Some(at_index) =
                                        strings::last_index_of_char(dep_literal, b'@')
                                    {
                                        let mut v = Vec::new();
                                        write!(
                                            &mut v,
                                            "{}@{}",
                                            bstr::BStr::new(&dep_literal[0..at_index]),
                                            bstr::BStr::new(&new_version)
                                        )
                                        .unwrap();
                                        break 'npm leak_str(v);
                                    }
                                }

                                break 'npm leak_str(new_version);
                            }
                        }
                        if request.version.tag == dependency::Tag::DistTag
                            || (manager.subcommand == Subcommand::Update
                                && request.version.tag == dependency::Tag::Npm
                                && !request.version.npm().version.is_exact())
                        {
                            let new_version: Vec<u8> = {
                                // `tag == Npm` matched at the top of this arm.
                                let version_fmt = resolutions[request.package_id as usize]
                                    .npm()
                                    .version
                                    .fmt(request.version_buf());
                                let mut v = Vec::new();
                                if options.exact_versions {
                                    write!(&mut v, "{}", version_fmt)
                                        .expect("infallible: in-memory write");
                                } else {
                                    write!(&mut v, "^{}", version_fmt)
                                        .expect("infallible: in-memory write");
                                }
                                // PERF(port): was comptime bool dispatch — profile in Phase B
                                v
                            };

                            if request.version.tag == dependency::Tag::Npm
                                && request.version.npm().is_alias
                            {
                                let dep_literal =
                                    request.version.literal.slice(request.version_buf());
                                if let Some(at_index) = strings::index_of_char(dep_literal, b'@') {
                                    let at_index = at_index as usize;
                                    let mut v = Vec::new();
                                    write!(
                                        &mut v,
                                        "{}@{}",
                                        bstr::BStr::new(&dep_literal[0..at_index]),
                                        bstr::BStr::new(&new_version)
                                    )
                                    .unwrap();
                                    break 'npm leak_str(v);
                                }
                            }

                            break 'npm leak_str(new_version);
                        }

                        leak_dup(request.version.literal.slice(request.version_buf()))
                    }

                    resolution::Tag::Workspace => b"workspace:*",
                    _ => leak_dup(request.version.literal.slice(request.version_buf())),
                });
        }
    }
    Ok(())
}

const TRUSTED_DEPENDENCIES_STRING: &[u8] = b"trustedDependencies";

// ported from: src/install/PackageManager/PackageJSONEditor.zig
