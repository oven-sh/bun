use bun_ast::{E, Expr};
use bun_collections::VecExt as _;
use bun_collections::index_sort;
use bun_core::strings;
use bun_semver::{PinnedVersion, Version};

use crate::lockfile::CatalogMap;
use crate::lockfile::override_map::{Field, OverrideRule};
use crate::lockfile_real::override_selector::{
    PackageSelector, Selector, parse_package_segment, parse_selector,
};
use crate::package_manager_real::add_remove_with_filter::{
    WorkspaceTarget, fetch_entry_root, store_entry,
};
use crate::package_manager_real::package_json_editor::for_each_catalog_object;
use crate::package_manager_real::package_json_write_back;
use crate::{PackageID, PackageManager};

#[derive(Clone)]
pub struct PackageJsonEdit {
    pub owner: PackageID,
    pub file: Box<[u8]>,
    pub site: EditSite,
    /// The package whose range is rewritten.
    pub key: Box<[u8]>,
    pub old_literal: Box<[u8]>,
    pub new_literal: Box<[u8]>,
}

#[derive(Clone, PartialEq, Eq)]
pub enum EditSite {
    /// `key` in whichever of the four dependency groups of `file` declares `old_literal`.
    Dependencies,
    /// `key` is in this catalog of the root package.json. An empty name means the default catalog.
    Catalog(Box<[u8]>),
    /// The rule for `key` in the root package.json's `overrides` (or `resolutions`).
    Override(OverrideSelector),
}

/// A rule as `OverrideMap` normalizes it, minus the target name (the edit's `key`).
#[derive(Clone, PartialEq, Eq)]
pub struct OverrideSelector {
    /// The name and range of the dependent that the rule is scoped to. An empty range matches any
    /// version.
    pub parent: Option<(Box<[u8]>, Box<[u8]>)>,
    /// Empty when the rule applies whatever range the dependent declares.
    pub target_range: Box<[u8]>,
}

impl OverrideSelector {
    pub(super) fn from_rule(rule: OverrideRule<'_>, buf: &[u8]) -> OverrideSelector {
        let OverrideRule::Scoped(rule) = rule else {
            return OverrideSelector {
                parent: None,
                target_range: Box::default(),
            };
        };
        let text = |s: &bun_semver::String| Box::from(s.slice(buf));
        let parent = rule.parent.as_ref();
        OverrideSelector {
            parent: parent.map(|p| (text(&p.name), text(&p.version.literal))),
            target_range: text(&rule.target_range.literal),
        }
    }

    /// A plain `"name": ...` rule, as opposed to one scoped to a parent or to a declared range.
    pub fn is_bare(&self) -> bool {
        self.parent.is_none() && self.target_range.is_empty()
    }

    /// `parent@range>name@range`, the form bun.lock writes and `overrides` also accepts.
    pub fn key(&self, name: &[u8]) -> Box<[u8]> {
        let mut out: Vec<u8> = Vec::new();
        if let Some((parent, parent_range)) = &self.parent {
            push_segment(&mut out, parent, parent_range);
            out.push(b'>');
        }
        push_segment(&mut out, name, &self.target_range);
        out.into_boxed_slice()
    }

    fn matches(
        &self,
        name: &[u8],
        parent: Option<PackageSelector>,
        target: PackageSelector,
    ) -> bool {
        let own_parent = self
            .parent
            .as_ref()
            .map(|(name, range)| (&**name, &**range));
        (target.name, target.range) == (name, &*self.target_range)
            && parent.map(|p| (p.name, p.range)) == own_parent
    }
}

fn push_segment(out: &mut Vec<u8>, name: &[u8], range: &[u8]) {
    out.extend_from_slice(name);
    if !range.is_empty() {
        out.push(b'@');
        out.extend_from_slice(range);
    }
}

impl PackageJsonEdit {
    pub(crate) fn same_site(&self, other: &PackageJsonEdit) -> bool {
        self.owner == other.owner
            && self.site == other.site
            && self.key == other.key
            && self.old_literal == other.old_literal
    }
}

pub(super) fn new_literal_for(old_literal: &[u8], to: &[u8], exact: bool) -> Box<[u8]> {
    let old = strings::trim(old_literal, &strings::WHITESPACE_CHARS);
    let old = crate::dependency::without_npm_protocol(old);
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

        let Some(target) = WorkspaceTarget::of_lockfile_package(&manager.lockfile, owner) else {
            debug_assert!(false, "audit fix edit owned by a non-importer package");
            continue;
        };
        apply_to_target(manager, &target, owned)?;
        package_json_write_back::record(manager, target, false);
    }
    Ok(())
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
            match &edit.site {
                EditSite::Dependencies => {
                    for group in bun_install_types::DependencyGroup::FOUR {
                        if let Some(mut query) = root.as_property(group.prop) {
                            rewrite_property(arena, &mut query.expr, edit);
                        }
                    }
                }
                EditSite::Catalog(catalog) => {
                    for_each_catalog_object(&root, |catalog_name, mut object| {
                        if CatalogMap::same_name(catalog_name, catalog) {
                            rewrite_property(arena, &mut object, edit);
                        }
                        Ok(())
                    })?;
                }
                EditSite::Override(selector) => {
                    for_each_override_value(&root, &edit.key, selector, |value| {
                        rewrite_value(arena, value, edit);
                    });
                }
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
        if key == &*edit.key {
            rewrite_value(arena, &mut prop.value, edit);
        }
    }
}

fn rewrite_value(arena: &bun_alloc::Arena, value: &mut Option<Expr>, edit: &PackageJsonEdit) {
    let Some(literal) = value.as_ref().and_then(Expr::as_utf8_string_literal) else {
        return;
    };
    if strings::trim(literal, &strings::WHITESPACE_CHARS) != &*edit.old_literal {
        return;
    }
    *value = Some(Expr::allocate(
        arena,
        E::EString::init(arena.alloc_slice_copy(&edit.new_literal)),
        bun_ast::Loc::EMPTY,
    ));
}

pub(super) fn root_package_json(manager: &mut PackageManager) -> Expr {
    fetch_entry_root(manager, &WorkspaceTarget::root())
}

/// When several entries spell the same rule, the last one, which `OverrideMap` keeps.
pub(super) fn override_literal(
    root: &Expr,
    name: &[u8],
    selector: &OverrideSelector,
) -> Option<Box<[u8]>> {
    let mut literal: Option<Box<[u8]>> = None;
    for_each_override_value(root, name, selector, |value| {
        if let Some(text) = value.as_ref().and_then(Expr::as_utf8_string_literal) {
            literal = Some(Box::from(strings::trim(text, &strings::WHITESPACE_CHARS)));
        }
    });
    literal
}

/// In file order, every entry `OverrideMap::parse_append` reads as `selector` for `name`.
fn for_each_override_value(
    root: &Expr,
    name: &[u8],
    selector: &OverrideSelector,
    mut f: impl FnMut(&mut Option<Expr>),
) {
    if let Some((field, rules)) = Field::of(root) {
        let nested = field == Field::Overrides;
        let mut rules = rules.expr;
        let Some(object) = rules.data.e_object_mut() else {
            return;
        };
        for prop in object.properties.slice_mut() {
            let Some(key) = prop.key.as_ref().and_then(Expr::as_utf8_string_literal) else {
                continue;
            };
            if !(nested && prop.value.as_ref().is_some_and(|value| value.is_object())) {
                if parse_selector(key).is_ok_and(|r| selector.matches(name, r.parent, r.target)) {
                    f(&mut prop.value);
                }
                continue;
            }
            let Ok(parent) = parse_package_segment(key) else {
                continue;
            };
            let Some(group) = prop.value.as_mut().and_then(|v| v.data.e_object_mut()) else {
                continue;
            };
            for child in group.properties.slice_mut() {
                let Some(child_key) = child.key.as_ref().and_then(Expr::as_utf8_string_literal)
                else {
                    continue;
                };
                let (rule_parent, target) = match parse_selector(child_key) {
                    _ if child_key == b"." => (None, parent),
                    Ok(Selector {
                        parent: None,
                        target,
                    }) => (Some(parent), target),
                    _ => continue,
                };
                if selector.matches(name, rule_parent, target) {
                    f(&mut child.value);
                }
            }
        }
    }
}
