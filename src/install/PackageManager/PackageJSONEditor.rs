use std::io::Write as _;

use bun_js_parser as js_ast;
use bun_js_parser::{E, Expr, G};
use bun_logger as logger;
use bun_semver as semver;
use bun_str::strings;

use bun_install::Dependency;
use bun_install::invalid_package_id;
use bun_install::package_manager::{PackageManager, UpdateRequest};

const DEPENDENCY_GROUPS: &[(&[u8], Dependency::Behavior)] = &[
    (b"optionalDependencies", Dependency::Behavior { optional: true, ..Dependency::Behavior::DEFAULT }),
    (b"devDependencies", Dependency::Behavior { dev: true, ..Dependency::Behavior::DEFAULT }),
    (b"dependencies", Dependency::Behavior { prod: true, ..Dependency::Behavior::DEFAULT }),
    (b"peerDependencies", Dependency::Behavior { peer: true, ..Dependency::Behavior::DEFAULT }),
];

#[derive(Default)]
pub struct EditOptions {
    pub exact_versions: bool,
    pub add_trusted_dependencies: bool,
    pub before_install: bool,
}

pub fn edit_patched_dependencies(
    manager: &mut PackageManager,
    package_json: &mut Expr,
    patch_key: &[u8],
    patchfile_path: &[u8],
) -> Result<(), bun_alloc::AllocError> {
    let _ = manager;
    // const pkg_to_patch = manager.
    let mut patched_dependencies = 'brk: {
        if let Some(query) = package_json.as_property(b"patchedDependencies") {
            if let js_ast::ExprData::EObject(obj) = &query.expr.data {
                break 'brk (**obj).clone();
            }
        }
        E::Object::default()
    };

    let patchfile_expr = Expr::init(
        E::String {
            data: Box::<[u8]>::from(patchfile_path),
        },
        logger::Loc::EMPTY,
    )
    .clone_expr()?;

    patched_dependencies.put(patch_key, patchfile_expr)?;

    // TODO(port): package_json.data.e_object — direct variant field access; assumes EObject
    package_json
        .data
        .e_object_mut()
        .put(
            b"patchedDependencies",
            Expr::init(patched_dependencies, logger::Loc::EMPTY).clone_expr()?,
        )?;
    Ok(())
}

pub fn edit_trusted_dependencies(
    package_json: &mut Expr,
    names_to_add: &mut [Box<[u8]>],
) -> Result<(), bun_alloc::AllocError> {
    let mut len = names_to_add.len();

    let original_trusted_dependencies = 'brk: {
        if let Some(query) = package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
            if let js_ast::ExprData::EArray(arr) = &query.expr.data {
                break 'brk (**arr).clone();
            }
        }
        E::Array::default()
    };

    for i in 0..names_to_add.len() {
        let name = &names_to_add[i];
        for item in original_trusted_dependencies.items.slice() {
            if let js_ast::ExprData::EString(s) = &item.data {
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
        if let js_ast::ExprData::EArray(arr) = &query.expr.data {
            trusted_dependencies = arr.items.slice();
        }
    }

    let trusted_dependencies_to_add = len;
    let new_trusted_deps: js_ast::ExprNodeList = {
        let mut deps = vec![Expr::EMPTY; trusted_dependencies.len() + trusted_dependencies_to_add]
            .into_boxed_slice();
        deps[0..trusted_dependencies.len()].clone_from_slice(trusted_dependencies);
        // tail already initialized to Expr::EMPTY by vec!

        for name in &names_to_add[0..len] {
            #[cfg(debug_assertions)]
            {
                let mut has_missing = false;
                for dep in deps.iter() {
                    if matches!(dep.data, js_ast::ExprData::EMissing(_)) {
                        has_missing = true;
                    }
                }
                debug_assert!(has_missing);
            }

            let mut i = deps.len();
            while i > 0 {
                i -= 1;
                if matches!(deps[i].data, js_ast::ExprData::EMissing(_)) {
                    deps[i] = Expr::init(
                        E::String {
                            data: name.clone(),
                        },
                        logger::Loc::EMPTY,
                    )
                    .clone_expr()?;
                    break;
                }
            }
        }

        #[cfg(debug_assertions)]
        for dep in deps.iter() {
            debug_assert!(!matches!(dep.data, js_ast::ExprData::EMissing(_)));
        }

        js_ast::ExprNodeList::from_owned_slice(deps)
    };

    let mut needs_new_trusted_dependencies_list = true;
    let trusted_dependencies_array: Expr = 'brk: {
        if let Some(query) = package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
            if matches!(query.expr.data, js_ast::ExprData::EArray(_)) {
                needs_new_trusted_dependencies_list = false;
                break 'brk query.expr;
            }
        }

        Expr::init(
            E::Array {
                items: new_trusted_deps.clone(),
                ..Default::default()
            },
            logger::Loc::EMPTY,
        )
    };

    if trusted_dependencies_to_add > 0 && new_trusted_deps.len() > 0 {
        // TODO(port): direct e_array field access — assumes EArray variant
        let arr = trusted_dependencies_array.data.e_array_mut();
        arr.items = new_trusted_deps;
        arr.alphabetize_strings();
    }

    if !matches!(package_json.data, js_ast::ExprData::EObject(_))
        || package_json.data.e_object().properties.len() == 0
    {
        let mut root_properties = vec![G::Property::default(); 1].into_boxed_slice();
        root_properties[0] = G::Property {
            key: Some(Expr::init(
                E::String {
                    data: Box::<[u8]>::from(TRUSTED_DEPENDENCIES_STRING),
                },
                logger::Loc::EMPTY,
            )),
            value: Some(trusted_dependencies_array),
            ..Default::default()
        };

        *package_json = Expr::init(
            E::Object {
                properties: G::Property::List::from_owned_slice(root_properties),
                ..Default::default()
            },
            logger::Loc::EMPTY,
        );
    } else if needs_new_trusted_dependencies_list {
        let old_len = package_json.data.e_object().properties.len();
        let mut root_properties = vec![G::Property::default(); old_len + 1].into_boxed_slice();
        root_properties[0..old_len]
            .clone_from_slice(package_json.data.e_object().properties.slice());
        let last = root_properties.len() - 1;
        root_properties[last] = G::Property {
            key: Some(Expr::init(
                E::String {
                    data: Box::<[u8]>::from(TRUSTED_DEPENDENCIES_STRING),
                },
                logger::Loc::EMPTY,
            )),
            value: Some(trusted_dependencies_array),
            ..Default::default()
        };
        *package_json = Expr::init(
            E::Object {
                properties: G::Property::List::from_owned_slice(root_properties),
                ..Default::default()
            },
            logger::Loc::EMPTY,
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
    options: &EditOptions,
) -> Result<(), bun_alloc::AllocError> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    Expr::Disabler::disable();
    let _guard = scopeguard::guard((), |_| Expr::Disabler::enable());

    for group in DEPENDENCY_GROUPS {
        let group_str = group.0;

        if let Some(root) = current_package_json.as_property(group_str) {
            if matches!(root.expr.data, js_ast::ExprData::EObject(_)) {
                if options.before_install {
                    // set each npm dependency to latest
                    for dep in root.expr.data.e_object_mut().properties.slice_mut() {
                        let Some(key) = &dep.key else { continue };
                        if !matches!(key.data, js_ast::ExprData::EString(_)) {
                            continue;
                        }
                        let Some(value) = &dep.value else { continue };
                        if !matches!(value.data, js_ast::ExprData::EString(_)) {
                            continue;
                        }

                        let version_literal = value
                            .as_string_cloned()?
                            .unwrap_or_else(|| bun_core::out_of_memory());
                        let mut tag = Dependency::Version::Tag::infer(&version_literal);

                        // only updating dependencies with npm versions, dist-tags if `--latest`, and catalog versions.
                        if tag != Dependency::Version::Tag::Npm
                            && (tag != Dependency::Version::Tag::DistTag
                                || !manager.options.do_.update_to_latest)
                            && tag != Dependency::Version::Tag::Catalog
                        {
                            continue;
                        }

                        let mut alias_at_index: Option<usize> = None;
                        if strings::trim(&version_literal, strings::WHITESPACE_CHARS)
                            .starts_with(b"npm:")
                        {
                            // negative because the real package might have a scope
                            // e.g. "dep": "npm:@foo/bar@1.2.3"
                            if let Some(at_index) =
                                strings::last_index_of_char(&version_literal, b'@')
                            {
                                tag = Dependency::Version::Tag::infer(
                                    &version_literal[at_index + 1..],
                                );
                                if tag != Dependency::Version::Tag::Npm
                                    && (tag != Dependency::Version::Tag::DistTag
                                        || !manager.options.do_.update_to_latest)
                                    && tag != Dependency::Version::Tag::Catalog
                                {
                                    continue;
                                }
                                alias_at_index = Some(at_index);
                            }
                        }

                        let key_str = key.as_string_cloned()?.expect("unreachable");
                        let entry = manager.updating_packages.get_or_put(key_str);

                        // If a dependency is present in more than one dependency group, only one of it's versions
                        // will be updated. The group is determined by the order of `dependency_groups`, the same
                        // order used to choose which version to install.
                        if entry.found_existing {
                            continue;
                        }

                        *entry.value_ptr = bun_install::package_manager::UpdatingPackage {
                            original_version_literal: version_literal.clone(),
                            is_alias: alias_at_index.is_some(),
                            original_version: None,
                        };

                        if manager.options.do_.update_to_latest {
                            // is it an aliased package
                            let temp_version: Box<[u8]> = if let Some(at_index) = alias_at_index {
                                let mut v = Vec::new();
                                write!(
                                    &mut v,
                                    "{}@latest",
                                    bstr::BStr::new(&version_literal[0..at_index])
                                )
                                .unwrap();
                                v.into_boxed_slice()
                            } else {
                                Box::<[u8]>::from(&b"latest"[..])
                            };

                            dep.value = Some(Expr::allocate(
                                E::String { data: temp_version },
                                logger::Loc::EMPTY,
                            ));
                        }
                    }
                } else {
                    let lockfile = &manager.lockfile;
                    let string_buf = lockfile.buffers.string_bytes.as_slice();
                    let workspace_package_id =
                        lockfile.get_workspace_package_id(manager.workspace_name_hash);
                    let packages = lockfile.packages.slice();
                    let resolutions = packages.items_resolution();
                    let deps = &packages.items_dependencies()[workspace_package_id as usize];
                    let resolution_ids =
                        &packages.items_resolutions()[workspace_package_id as usize];
                    let workspace_deps: &[Dependency] =
                        deps.get(lockfile.buffers.dependencies.as_slice());
                    let workspace_resolution_ids =
                        resolution_ids.get(lockfile.buffers.resolutions.as_slice());

                    for dep in root.expr.data.e_object_mut().properties.slice_mut() {
                        let Some(key) = &dep.key else { continue };
                        if !matches!(key.data, js_ast::ExprData::EString(_)) {
                            continue;
                        }
                        let Some(value) = &dep.value else { continue };
                        if !matches!(value.data, js_ast::ExprData::EString(_)) {
                            continue;
                        }

                        let key_str = key.as_string().unwrap_or_else(|| bun_core::out_of_memory());

                        'updated: {
                            // fetchSwapRemove because we want to update the first dependency with a matching
                            // name, or none at all
                            if let Some(entry) =
                                manager.updating_packages.fetch_swap_remove(&key_str)
                            {
                                let is_alias = entry.value.is_alias;
                                let dep_name = &entry.key;
                                debug_assert_eq!(workspace_deps.len(), workspace_resolution_ids.len());
                                for (workspace_dep, &package_id) in
                                    workspace_deps.iter().zip(workspace_resolution_ids)
                                {
                                    if package_id == invalid_package_id {
                                        continue;
                                    }

                                    let resolution = &resolutions[package_id as usize];
                                    if resolution.tag != bun_install::Resolution::Tag::Npm {
                                        continue;
                                    }

                                    let workspace_dep_name = workspace_dep.name.slice(string_buf);
                                    if !strings::eql_long(workspace_dep_name, dep_name, true) {
                                        continue;
                                    }

                                    let resolved_version = manager
                                        .lockfile
                                        .resolve_catalog_dependency(workspace_dep)
                                        .unwrap_or_else(|| workspace_dep.version.clone());
                                    if let Some(npm_version) = resolved_version.npm() {
                                        // It's possible we inserted a dependency that won't update (version is an exact version).
                                        // If we find one, skip to keep the original version literal.
                                        if !manager.options.do_.update_to_latest
                                            && npm_version.version.is_exact()
                                        {
                                            break 'updated;
                                        }
                                    }

                                    let new_version: Box<[u8]> = 'new_version: {
                                        let version_fmt =
                                            resolution.value.npm.version.fmt(string_buf);
                                        if options.exact_versions {
                                            let mut v = Vec::new();
                                            write!(&mut v, "{}", version_fmt).unwrap();
                                            break 'new_version v.into_boxed_slice();
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
                                                    .original_version_literal
                                                    [at_index + 1..];
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
                                                write!(&mut v, "{}", version_fmt).unwrap()
                                            }
                                            semver::PinnedVersion::Minor => {
                                                write!(&mut v, "~{}", version_fmt).unwrap()
                                            }
                                            semver::PinnedVersion::Major => {
                                                write!(&mut v, "^{}", version_fmt).unwrap()
                                            }
                                        }
                                        v.into_boxed_slice()
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
                                                E::String {
                                                    data: v.into_boxed_slice(),
                                                },
                                                logger::Loc::EMPTY,
                                            ));
                                            break 'updated;
                                        }

                                        // fallthrough and replace entire version.
                                    }

                                    dep.value = Some(Expr::allocate(
                                        E::String { data: new_version },
                                        logger::Loc::EMPTY,
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
    // TODO(port): Zig `*[]UpdateRequest` — mutable slice whose len is shrunk in-place; using Vec for now
    updates: &mut Vec<UpdateRequest>,
    current_package_json: &mut Expr,
    dependency_list: &[u8],
    options: &EditOptions,
) -> Result<(), bun_alloc::AllocError> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    Expr::Disabler::disable();
    let _guard = scopeguard::guard((), |_| Expr::Disabler::enable());

    let mut remaining = updates.len();
    let mut replacing: usize = 0;
    let only_add_missing = manager.options.enable.only_missing;

    // There are three possible scenarios here
    // 1. There is no "dependencies" (or equivalent list) or it is empty
    // 2. There is a "dependencies" (or equivalent list), but the package name already exists in a separate list
    // 3. There is a "dependencies" (or equivalent list), and the package name exists in multiple lists
    // Try to use the existing spot in the dependencies list if possible
    {
        let original_trusted_dependencies = 'brk: {
            if !options.add_trusted_dependencies {
                break 'brk E::Array::default();
            }
            if let Some(query) = current_package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
                if let js_ast::ExprData::EArray(arr) = &query.expr.data {
                    // not modifying
                    break 'brk (**arr).clone();
                }
            }
            E::Array::default()
        };

        if options.add_trusted_dependencies {
            // Iterate backwards to avoid index issues when removing items
            let mut i: usize = manager.trusted_deps_to_add_to_package_json.len();
            while i > 0 {
                i -= 1;
                let trusted_package_name = &manager.trusted_deps_to_add_to_package_json[i];
                for item in original_trusted_dependencies.items.slice() {
                    if let js_ast::ExprData::EString(s) = &item.data {
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
                for list in [
                    b"dependencies".as_slice(),
                    b"devDependencies".as_slice(),
                    b"optionalDependencies".as_slice(),
                    b"peerDependencies".as_slice(),
                ] {
                    if let Some(query) = current_package_json.as_property(list) {
                        if matches!(query.expr.data, js_ast::ExprData::EObject(_)) {
                            let name = request.get_name();

                            if let Some(value) = query.expr.as_property(name) {
                                if matches!(value.expr.data, js_ast::ExprData::EString(_)) {
                                    if request.package_id != invalid_package_id
                                        && strings::eql_long(list, dependency_list, true)
                                    {
                                        replacing += 1;
                                    } else {
                                        if manager.subcommand == bun_install::Subcommand::Update
                                            && options.before_install
                                        {
                                            'add_packages_to_update: {
                                                let Some(version_literal) =
                                                    value.expr.as_string_cloned()?
                                                else {
                                                    break 'add_packages_to_update;
                                                };
                                                let mut tag = Dependency::Version::Tag::infer(
                                                    &version_literal,
                                                );

                                                if tag != Dependency::Version::Tag::Npm
                                                    && tag != Dependency::Version::Tag::DistTag
                                                {
                                                    break 'add_packages_to_update;
                                                }

                                                let entry = manager
                                                    .updating_packages
                                                    .get_or_put(Box::<[u8]>::from(name));

                                                // first come, first serve
                                                if entry.found_existing {
                                                    break 'add_packages_to_update;
                                                }

                                                let mut is_alias = false;
                                                if strings::trim(
                                                    &version_literal,
                                                    strings::WHITESPACE_CHARS,
                                                )
                                                .starts_with(b"npm:")
                                                {
                                                    if let Some(at_index) =
                                                        strings::last_index_of_char(
                                                            &version_literal,
                                                            b'@',
                                                        )
                                                    {
                                                        tag = Dependency::Version::Tag::infer(
                                                            &version_literal[at_index + 1..],
                                                        );
                                                        if tag != Dependency::Version::Tag::Npm
                                                            && tag
                                                                != Dependency::Version::Tag::DistTag
                                                        {
                                                            break 'add_packages_to_update;
                                                        }
                                                        is_alias = true;
                                                    }
                                                }

                                                *entry.value_ptr =
                                                    bun_install::package_manager::UpdatingPackage {
                                                        original_version_literal: version_literal,
                                                        is_alias,
                                                        original_version: None,
                                                    };
                                            }
                                        }
                                        if !only_add_missing {
                                            // TODO(port): e_string is Option<*mut E::String> on UpdateRequest
                                            request.e_string =
                                                Some(value.expr.data.e_string_ptr());
                                            remaining -= 1;
                                        } else {
                                            let last = updates.len() - 1;
                                            if i < last {
                                                updates.swap(i, last);
                                            }
                                            updates.truncate(last);
                                            remaining -= 1;
                                            continue 'loop_;
                                        }
                                    }
                                }
                                break;
                            } else {
                                if request.version.tag == Dependency::Version::Tag::Github
                                    || request.version.tag == Dependency::Version::Tag::Git
                                {
                                    for item in query.expr.data.e_object().properties.slice() {
                                        if let Some(v) = &item.value {
                                            let url = request
                                                .version
                                                .literal
                                                .slice(&request.version_buf);
                                            if let js_ast::ExprData::EString(s) = &v.data {
                                                if s.eql_bytes(url) {
                                                    request.e_string =
                                                        Some(v.data.e_string_ptr());
                                                    remaining -= 1;
                                                    break;
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
        let mut dependencies: &[G::Property] = &[];
        if let Some(query) = current_package_json.as_property(dependency_list) {
            if let js_ast::ExprData::EObject(obj) = &query.expr.data {
                dependencies = obj.properties.slice();
            }
        }

        let mut new_dependencies: Vec<G::Property> =
            Vec::with_capacity(dependencies.len() + remaining - replacing);
        new_dependencies.resize(dependencies.len() + remaining - replacing, G::Property::default());

        new_dependencies[..dependencies.len()].clone_from_slice(dependencies);
        // tail already initialized to G::Property::default() by resize

        let mut trusted_dependencies: &[Expr] = &[];
        if options.add_trusted_dependencies {
            if let Some(query) = current_package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
                if let js_ast::ExprData::EArray(arr) = &query.expr.data {
                    trusted_dependencies = arr.items.slice();
                }
            }
        }

        let trusted_dependencies_to_add = manager.trusted_deps_to_add_to_package_json.len();
        let new_trusted_deps: js_ast::ExprNodeList = 'brk: {
            if !options.add_trusted_dependencies || trusted_dependencies_to_add == 0 {
                break 'brk js_ast::ExprNodeList::EMPTY;
            }

            let mut deps =
                vec![Expr::EMPTY; trusted_dependencies.len() + trusted_dependencies_to_add]
                    .into_boxed_slice();
            deps[0..trusted_dependencies.len()].clone_from_slice(trusted_dependencies);
            // tail already initialized to Expr::EMPTY

            for package_name in &manager.trusted_deps_to_add_to_package_json {
                #[cfg(debug_assertions)]
                {
                    let mut has_missing = false;
                    for dep in deps.iter() {
                        if matches!(dep.data, js_ast::ExprData::EMissing(_)) {
                            has_missing = true;
                        }
                    }
                    debug_assert!(has_missing);
                }

                let mut i = deps.len();
                while i > 0 {
                    i -= 1;
                    if matches!(deps[i].data, js_ast::ExprData::EMissing(_)) {
                        deps[i] = Expr::allocate(
                            E::String {
                                data: package_name.clone(),
                            },
                            logger::Loc::EMPTY,
                        );
                        break;
                    }
                }
            }

            #[cfg(debug_assertions)]
            for dep in deps.iter() {
                debug_assert!(!matches!(dep.data, js_ast::ExprData::EMissing(_)));
            }

            js_ast::ExprNodeList::from_owned_slice(deps)
        };

        for request in updates.iter_mut() {
            if request.e_string.is_some() {
                continue;
            }
            let _assert_guard = scopeguard::guard((), |_| {
                #[cfg(debug_assertions)]
                debug_assert!(request.e_string.is_some());
            });
            // TODO(port): the above scopeguard borrows `request`; Phase B may need to inline the assert after the loop body

            let mut k: usize = 0;
            while k < new_dependencies.len() {
                if let Some(key) = &new_dependencies[k].key {
                    let name = request.get_name();
                    if !key.data.e_string().eql_bytes(name) {
                        k += 1;
                        continue;
                    }
                    if request.package_id == invalid_package_id {
                        // Duplicate dependency (e.g., "react" in both "dependencies" and
                        // "optionalDependencies"). Remove the old dependency.
                        new_dependencies[k] = G::Property::default();
                        // TODO(port): Zig does `items.len -= 1` here without shifting; replicating via truncate
                        let new_len = new_dependencies.len() - 1;
                        new_dependencies.truncate(new_len);
                    }
                }

                new_dependencies[k].key = Some(Expr::allocate(
                    E::String {
                        data: Box::<[u8]>::from(request.get_resolved_name(&manager.lockfile)),
                    },
                    logger::Loc::EMPTY,
                ));

                new_dependencies[k].value = Some(Expr::allocate(
                    E::String {
                        // we set it later
                        data: Box::default(),
                    },
                    logger::Loc::EMPTY,
                ));

                request.e_string = Some(
                    new_dependencies[k]
                        .value
                        .as_ref()
                        .unwrap()
                        .data
                        .e_string_ptr(),
                );
                break;
            }
        }

        let mut needs_new_dependency_list = true;
        let dependencies_object: Expr = 'brk: {
            if let Some(query) = current_package_json.as_property(dependency_list) {
                if matches!(query.expr.data, js_ast::ExprData::EObject(_)) {
                    needs_new_dependency_list = false;
                    break 'brk query.expr;
                }
            }

            Expr::allocate(
                E::Object {
                    properties: G::Property::List::EMPTY,
                    ..Default::default()
                },
                logger::Loc::EMPTY,
            )
        };

        // TODO(port): direct e_object field access — assumes EObject variant
        dependencies_object.data.e_object_mut().properties =
            G::Property::List::move_from_list(&mut new_dependencies);
        if dependencies_object.data.e_object().properties.len() > 1 {
            dependencies_object.data.e_object_mut().alphabetize_properties();
        }

        let mut needs_new_trusted_dependencies_list = true;
        let trusted_dependencies_array: Expr = 'brk: {
            if !options.add_trusted_dependencies || trusted_dependencies_to_add == 0 {
                needs_new_trusted_dependencies_list = false;
                break 'brk Expr::EMPTY;
            }
            if let Some(query) = current_package_json.as_property(TRUSTED_DEPENDENCIES_STRING) {
                if matches!(query.expr.data, js_ast::ExprData::EArray(_)) {
                    needs_new_trusted_dependencies_list = false;
                    break 'brk query.expr;
                }
            }

            Expr::allocate(
                E::Array {
                    items: new_trusted_deps.clone(),
                    ..Default::default()
                },
                logger::Loc::EMPTY,
            )
        };

        if options.add_trusted_dependencies && trusted_dependencies_to_add > 0 {
            let arr = trusted_dependencies_array.data.e_array_mut();
            arr.items = new_trusted_deps;
            if arr.items.len() > 1 {
                arr.alphabetize_strings();
            }
        }

        if !matches!(current_package_json.data, js_ast::ExprData::EObject(_))
            || current_package_json.data.e_object().properties.len() == 0
        {
            let n = if options.add_trusted_dependencies { 2 } else { 1 };
            let mut root_properties = vec![G::Property::default(); n].into_boxed_slice();
            root_properties[0] = G::Property {
                key: Some(Expr::allocate(
                    E::String {
                        data: Box::<[u8]>::from(dependency_list),
                    },
                    logger::Loc::EMPTY,
                )),
                value: Some(dependencies_object),
                ..Default::default()
            };

            if options.add_trusted_dependencies {
                root_properties[1] = G::Property {
                    key: Some(Expr::allocate(
                        E::String {
                            data: Box::<[u8]>::from(TRUSTED_DEPENDENCIES_STRING),
                        },
                        logger::Loc::EMPTY,
                    )),
                    value: Some(trusted_dependencies_array),
                    ..Default::default()
                };
            }

            *current_package_json = Expr::allocate(
                E::Object {
                    properties: G::Property::List::from_owned_slice(root_properties),
                    ..Default::default()
                },
                logger::Loc::EMPTY,
            );
        } else {
            if needs_new_dependency_list && needs_new_trusted_dependencies_list {
                let old_len = current_package_json.data.e_object().properties.len();
                let mut root_properties =
                    vec![G::Property::default(); old_len + 2].into_boxed_slice();
                root_properties[0..old_len]
                    .clone_from_slice(current_package_json.data.e_object().properties.slice());
                let rlen = root_properties.len();
                root_properties[rlen - 2] = G::Property {
                    key: Some(Expr::allocate(
                        E::String {
                            data: Box::<[u8]>::from(dependency_list),
                        },
                        logger::Loc::EMPTY,
                    )),
                    value: Some(dependencies_object),
                    ..Default::default()
                };
                root_properties[rlen - 1] = G::Property {
                    key: Some(Expr::allocate(
                        E::String {
                            data: Box::<[u8]>::from(TRUSTED_DEPENDENCIES_STRING),
                        },
                        logger::Loc::EMPTY,
                    )),
                    value: Some(trusted_dependencies_array),
                    ..Default::default()
                };
                *current_package_json = Expr::allocate(
                    E::Object {
                        properties: G::Property::List::from_owned_slice(root_properties),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                );
            } else if needs_new_dependency_list || needs_new_trusted_dependencies_list {
                let old_len = current_package_json.data.e_object().properties.len();
                let mut root_properties =
                    vec![G::Property::default(); old_len + 1].into_boxed_slice();
                root_properties[0..old_len]
                    .clone_from_slice(current_package_json.data.e_object().properties.slice());
                let last = root_properties.len() - 1;
                root_properties[last] = G::Property {
                    key: Some(Expr::allocate(
                        E::String {
                            data: if needs_new_dependency_list {
                                Box::<[u8]>::from(dependency_list)
                            } else {
                                Box::<[u8]>::from(TRUSTED_DEPENDENCIES_STRING)
                            },
                        },
                        logger::Loc::EMPTY,
                    )),
                    value: Some(if needs_new_dependency_list {
                        dependencies_object
                    } else {
                        trusted_dependencies_array
                    }),
                    ..Default::default()
                };
                *current_package_json = Expr::allocate(
                    E::Object {
                        properties: G::Property::List::from_owned_slice(root_properties),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
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
            // SAFETY: e_string was set above to point at a live E::String inside an Expr we own
            let e_string = unsafe { &mut *e_string };
            if request.package_id as usize >= resolutions.len()
                || resolutions[request.package_id as usize].tag
                    == bun_install::Resolution::Tag::Uninitialized
            {
                e_string.data = 'uninitialized: {
                    if manager.subcommand == bun_install::Subcommand::Update
                        && manager.options.do_.update_to_latest
                    {
                        break 'uninitialized Box::<[u8]>::from(&b"latest"[..]);
                    }

                    if manager.subcommand != bun_install::Subcommand::Update
                        || !options.before_install
                        || e_string.is_blank()
                        || request.version.tag == Dependency::Version::Tag::Npm
                    {
                        break 'uninitialized match request.version.tag {
                            Dependency::Version::Tag::Uninitialized => {
                                Box::<[u8]>::from(&b"latest"[..])
                            }
                            _ => Box::<[u8]>::from(
                                request.version.literal.slice(&request.version_buf),
                            ),
                        };
                    } else {
                        // TODO(port): re-assigning own data; clone to satisfy borrowck
                        break 'uninitialized e_string.data.clone();
                    }
                };

                continue;
            }
            e_string.data = match resolutions[request.package_id as usize].tag {
                bun_install::Resolution::Tag::Npm => 'npm: {
                    if manager.subcommand == bun_install::Subcommand::Update
                        && (request.version.tag == Dependency::Version::Tag::DistTag
                            || request.version.tag == Dependency::Version::Tag::Npm)
                    {
                        if let Some(entry) =
                            manager.updating_packages.fetch_swap_remove(&request.name)
                        {
                            let mut alias_at_index: Option<usize> = None;

                            let new_version: Box<[u8]> = 'new_version: {
                                let version_fmt = resolutions[request.package_id as usize]
                                    .value
                                    .npm
                                    .version
                                    .fmt(manager.lockfile.buffers.string_bytes.as_slice());
                                if options.exact_versions {
                                    let mut v = Vec::new();
                                    write!(&mut v, "{}", version_fmt).unwrap();
                                    break 'new_version v.into_boxed_slice();
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
                                        alias_at_index = Some(at_index);
                                        break 'version_literal &entry
                                            .value
                                            .original_version_literal
                                            [at_index + 1..];
                                    }

                                    &entry.value.original_version_literal
                                };

                                let pinned_version =
                                    semver::Version::which_version_is_pinned(version_literal);
                                let mut v = Vec::new();
                                match pinned_version {
                                    semver::PinnedVersion::Patch => {
                                        write!(&mut v, "{}", version_fmt).unwrap()
                                    }
                                    semver::PinnedVersion::Minor => {
                                        write!(&mut v, "~{}", version_fmt).unwrap()
                                    }
                                    semver::PinnedVersion::Major => {
                                        write!(&mut v, "^{}", version_fmt).unwrap()
                                    }
                                }
                                v.into_boxed_slice()
                            };

                            let _ = alias_at_index;

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
                                    break 'npm v.into_boxed_slice();
                                }
                            }

                            break 'npm new_version;
                        }
                    }
                    if request.version.tag == Dependency::Version::Tag::DistTag
                        || (manager.subcommand == bun_install::Subcommand::Update
                            && request.version.tag == Dependency::Version::Tag::Npm
                            && !request.version.value.npm.version.is_exact())
                    {
                        let new_version: Box<[u8]> = {
                            let version_fmt = resolutions[request.package_id as usize]
                                .value
                                .npm
                                .version
                                .fmt(&request.version_buf);
                            let mut v = Vec::new();
                            if options.exact_versions {
                                write!(&mut v, "{}", version_fmt).unwrap();
                            } else {
                                write!(&mut v, "^{}", version_fmt).unwrap();
                            }
                            // PERF(port): was comptime bool dispatch — profile in Phase B
                            v.into_boxed_slice()
                        };

                        if request.version.tag == Dependency::Version::Tag::Npm
                            && request.version.value.npm.is_alias
                        {
                            let dep_literal = request.version.literal.slice(&request.version_buf);
                            if let Some(at_index) = strings::index_of_char(dep_literal, b'@') {
                                let mut v = Vec::new();
                                write!(
                                    &mut v,
                                    "{}@{}",
                                    bstr::BStr::new(&dep_literal[0..at_index]),
                                    bstr::BStr::new(&new_version)
                                )
                                .unwrap();
                                break 'npm v.into_boxed_slice();
                            }
                        }

                        break 'npm new_version;
                    }

                    Box::<[u8]>::from(request.version.literal.slice(&request.version_buf))
                }

                bun_install::Resolution::Tag::Workspace => Box::<[u8]>::from(&b"workspace:*"[..]),
                _ => Box::<[u8]>::from(request.version.literal.slice(&request.version_buf)),
            };
        }
    }
    Ok(())
}

const TRUSTED_DEPENDENCIES_STRING: &[u8] = b"trustedDependencies";

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/PackageJSONEditor.zig (799 lines)
//   confidence: medium
//   todos:      8
//   notes:      Expr/E/G API surface (e_object_mut/e_string_ptr/allocate/init) assumed; UpdateRequest.e_string raw ptr semantics and *[]UpdateRequest shrinking need Phase B review; heavy borrowck reshaping likely needed around manager.lockfile + manager.updating_packages aliasing
// ──────────────────────────────────────────────────────────────────────────
