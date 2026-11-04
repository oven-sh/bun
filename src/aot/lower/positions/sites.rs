use bun_sema::check::aot::ShapeKind;

use super::SiteOrigin;
use crate::ir::generated::TypeSite;
use crate::ir::{StringId, TypeSiteId};
use crate::lower::{CheckerTypeId, FileLowering};

const MAX_UNION_MEMBERS_IN_TEXT: usize = 4;

pub(crate) fn add_type_site(
    file: &mut FileLowering<'_, '_, '_, '_>,
    origin: SiteOrigin,
    text: Option<CheckerTypeId>,
) -> TypeSiteId {
    // Only the log of type mismatches prints it.
    let text = text.filter(|_| file.inputs.options.reports_type_mismatches);
    let text = text.map(|ty| file.get_type_text(ty));
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

impl FileLowering<'_, '_, '_, '_> {
    // Every type that holds a reference takes undefined and null, so the text of a type does not list them.
    fn find_described_type(&mut self, ty: CheckerTypeId) -> CheckerTypeId {
        let Ok(described) = self.queries.without_nullish(ty) else {
            return ty;
        };
        match self.queries.type_shape(described) {
            Ok(shape) if shape.kind != ShapeKind::Never => described,
            Ok(_) | Err(_) => ty,
        }
    }

    fn write_type_text(&mut self, ty: CheckerTypeId) -> Vec<u8> {
        let ty = self.find_described_type(ty);
        let whole = self.queries.type_text(ty);
        let Ok(shape) = self.queries.type_shape(ty) else {
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
            shortened.extend_from_slice(&self.queries.type_text(member));
            shortened.extend_from_slice(b" | ");
        }
        // A union that has a name of its own is printed by that name.
        if !whole.starts_with(&shortened) {
            return whole;
        }
        shortened.extend_from_slice(b"...");
        shortened
    }

    fn get_type_text(&mut self, ty: CheckerTypeId) -> StringId {
        if let Some(&text) = self.types.positions.texts.get(&ty) {
            return text;
        }
        let text = self.write_type_text(ty);
        let id = self.intern_bytes(&text);
        self.types.positions.texts.insert(ty, id);
        id
    }
}
