use bun_ast::{E, Expr};
use bun_collections::VecExt as _;
use bun_collections::index_sort;
use bun_core::strings;
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{join_abs_string_buf, platform};
use bun_semver::{PinnedVersion, Version};

use crate::bun_fs::FileSystem;
use crate::lockfile::CatalogMap;
use crate::lockfile::package::PackageColumns as _;
use crate::package_manager_real::add_remove_with_filter::{
    WorkspaceTarget, fetch_entry_root, root_package_json_path, store_entry,
};
use crate::package_manager_real::package_json_editor::for_each_catalog_object;
use crate::package_manager_real::package_json_write_back;
use crate::{PackageID, PackageManager, ResolutionTag};

const DEPENDENCY_GROUPS: [&[u8]; 4] = [
    b"dependencies",
    b"devDependencies",
    b"optionalDependencies",
    b"peerDependencies",
];

#[derive(Clone)]
pub struct PackageJsonEdit {
    pub owner: PackageID,
    pub file: Box<[u8]>,
    pub catalog: Option<Box<[u8]>>,
    pub key: Box<[u8]>,
    pub old_literal: Box<[u8]>,
    pub new_literal: Box<[u8]>,
}

impl PackageJsonEdit {
    pub(crate) fn same_site(&self, other: &PackageJsonEdit) -> bool {
        self.owner == other.owner
            && self.catalog == other.catalog
            && self.key == other.key
            && self.old_literal == other.old_literal
    }
}

pub(super) fn new_literal_for(old_literal: &[u8], to: &[u8], exact: bool) -> Box<[u8]> {
    let old = strings::trim(old_literal, &strings::WHITESPACE_CHARS);
    let mut out: Vec<u8> = Vec::with_capacity(old.len() + to.len() + 2);
    let range: &[u8] = match old.strip_prefix(b"npm:") {
        Some(alias) => match strings::last_index_of_char(alias, b'@') {
            Some(i) if i > 0 => {
                out.extend_from_slice(&old[..b"npm:".len() + i + 1]);
                &alias[i + 1..]
            }
            _ => {
                out.extend_from_slice(old);
                out.push(b'@');
                b""
            }
        },
        None => old,
    };
    let range = strings::trim(range, &strings::WHITESPACE_CHARS);
    if range.starts_with(b"=") {
        out.push(b'=');
    } else if !exact {
        match Version::which_version_is_pinned(range) {
            PinnedVersion::Patch => {}
            PinnedVersion::Minor => out.push(b'~'),
            PinnedVersion::Major => out.push(b'^'),
        }
    }
    out.extend_from_slice(to);
    out.into_boxed_slice()
}

pub(super) fn apply(manager: &mut PackageManager, plan: &super::FixPlan) -> crate::Result<()> {
    let mut edits: Vec<&PackageJsonEdit> =
        plan.fixes.iter().flat_map(|fix| fix.edits.iter()).collect();
    if edits.is_empty() {
        return Ok(());
    }
    index_sort::sort_vec_by(&mut edits, |a, b| a.owner.cmp(&b.owner));

    let mut start = 0;
    while start < edits.len() {
        let owner = edits[start].owner;
        let end = start + edits[start..].partition_point(|edit| edit.owner == owner);
        let owned = &edits[start..end];
        start = end;

        let Some(target) = target_for(manager, owner) else {
            continue;
        };
        apply_to_target(manager, &target, owned)?;
        package_json_write_back::record(manager, target, false);
    }
    Ok(())
}

fn target_for(manager: &PackageManager, owner: PackageID) -> Option<WorkspaceTarget> {
    if owner == 0 {
        return Some(WorkspaceTarget {
            name: Box::default(),
            name_hash: None,
            package_json_path: root_package_json_path(),
        });
    }
    let lockfile = &manager.lockfile;
    let res = lockfile.packages.items_resolution()[owner as usize];
    match res.tag {
        ResolutionTag::Root => Some(WorkspaceTarget {
            name: Box::default(),
            name_hash: None,
            package_json_path: root_package_json_path(),
        }),
        ResolutionTag::Workspace => {
            let buf = lockfile.buffers.string_bytes.as_slice();
            let top_level = strings::without_trailing_slash(FileSystem::instance().top_level_dir());
            let mut path_buf = path_buffer_pool::get();
            Some(WorkspaceTarget {
                name: Box::from(lockfile.packages.items_name()[owner as usize].slice(buf)),
                name_hash: Some(lockfile.packages.items_name_hash()[owner as usize]),
                package_json_path: join_abs_string_buf::<platform::Auto>(
                    top_level,
                    &mut path_buf.0,
                    &[res.workspace().slice(buf), b"package.json"],
                )
                .into(),
            })
        }
        _ => {
            debug_assert!(false, "audit fix edit owned by a non-importer package");
            None
        }
    }
}

fn apply_to_target(
    manager: &mut PackageManager,
    target: &WorkspaceTarget,
    edits: &[&PackageJsonEdit],
) -> crate::Result<()> {
    let root = fetch_entry_root(manager, target);
    {
        let _guard = bun_ast::expr::Disabler::scope();
        let arena = &manager.ast_arena;
        for edit in edits {
            match &edit.catalog {
                None => {
                    for group in DEPENDENCY_GROUPS {
                        let Some(mut query) = root.as_property(group) else {
                            continue;
                        };
                        rewrite_property(arena, &mut query.expr, edit);
                    }
                }
                Some(catalog) => for_each_catalog_object(&root, |catalog_name, mut object| {
                    if CatalogMap::same_name(catalog_name, catalog) {
                        rewrite_property(arena, &mut object, edit);
                    }
                    Ok(())
                })?,
            }
        }
    }
    store_entry(manager, target, root);
    Ok(())
}

fn rewrite_property(arena: &bun_alloc::Arena, object: &mut Expr, edit: &PackageJsonEdit) {
    let Some(object) = object.data.e_object_mut() else {
        return;
    };
    for prop in object.properties.slice_mut() {
        let Some(key) = prop.key.as_ref().and_then(Expr::as_utf8_string_literal) else {
            continue;
        };
        if key != &*edit.key {
            continue;
        }
        let Some(value) = prop.value.as_ref().and_then(Expr::as_utf8_string_literal) else {
            continue;
        };
        if strings::trim(value, &strings::WHITESPACE_CHARS) != &*edit.old_literal {
            continue;
        }
        prop.value = Some(Expr::allocate(
            arena,
            E::EString::init(arena.alloc_slice_copy(&edit.new_literal)),
            bun_ast::Loc::EMPTY,
        ));
    }
}
