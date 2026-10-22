use bun_sema::check::aot::ShapeKind;

use super::SiteOrigin;
use crate::ir::generated::TypeSite;
use crate::ir::{StringId, TypeSiteId};
use crate::lower::{CheckerTypeId, FileLowering};

const MAX_UNION_MEMBERS_IN_TEXT: usize = 4;

pub(super) fn add_type_site(
    file: &mut FileLowering<'_, '_, '_, '_>,
    origin: SiteOrigin,
    text: Option<CheckerTypeId>,
) -> TypeSiteId {
    // Only the log of type mismatches prints it.
    let text = text.filter(|_| file.inputs.options.reports_type_mismatches);
    let text = text.map(|ty| get_type_text(file, ty));
    let site = TypeSite {
        module: file.module_id(),
        position: origin.position,
        kind: origin.kind,
        text,
    };
    if let Some(&id) = file.types.positions.sites.get(&site) {
        return id;
    }
    let id = file.fragment.add_type_site(site);
    file.types.positions.sites.insert(site, id);
    id
}

// Every type that holds a reference takes undefined and null, so the text of a type does not list them.
fn find_described_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> CheckerTypeId {
    let Ok(described) = file.queries.without_nullish(ty) else {
        return ty;
    };
    match file.queries.type_shape(described) {
        Ok(shape) if shape.kind != ShapeKind::Never => described,
        Ok(_) | Err(_) => ty,
    }
}

fn write_type_text(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Vec<u8> {
    let ty = find_described_type(file, ty);
    let whole = file.queries.type_text(ty);
    let Ok(shape) = file.queries.type_shape(ty) else {
        return whole;
    };
    let ShapeKind::Union(members) = shape.kind else {
        return whole;
    };
    if members.len() <= MAX_UNION_MEMBERS_IN_TEXT {
        return whole;
    }
    let mut shortened = Vec::new();
    for &member in &members[..MAX_UNION_MEMBERS_IN_TEXT] {
        shortened.extend_from_slice(&file.queries.type_text(member));
        shortened.extend_from_slice(b" | ");
    }
    // A union that has a name of its own is printed by that name.
    if !whole.starts_with(&shortened) {
        return whole;
    }
    shortened.extend_from_slice(b"...");
    shortened
}

fn get_type_text(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> StringId {
    if let Some(&text) = file.types.positions.texts.get(&ty) {
        return text;
    }
    let text = write_type_text(file, ty);
    let id = file.intern_bytes(&text);
    file.types.positions.texts.insert(ty, id);
    id
}
