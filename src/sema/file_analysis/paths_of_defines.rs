use crate::atom::{Interner, known};
use crate::fold::PathInPlace;
use crate::hir::{
    Chain, Expr, ExprFlags, ExprId, ExprKind, File, FileBuilder, PropKey, PropKind, rare,
};
use crate::session::Arena;

/// `--define LEVEL=settings.level`: writes `settings.level` where `LEVEL` stands.
pub(super) fn write_paths_of_defines<'s>(
    hir: &mut File<'s>,
    places: &[(ExprId, u32)],
    names_in_place: &[PathInPlace<'_>],
    atoms: &Interner<'s>,
    arena: &'s Arena,
) {
    let mut file = FileBuilder::from_file(hir);
    for property in &mut file.props {
        if property.kind == PropKind::Shorthand
            && property.key != PropKey::Name(known::__proto__)
            && (places.binary_search_by_key(&property.value, |it| it.0)).is_ok()
        {
            property.kind = PropKind::Init;
        }
    }
    for &(place, index) in places {
        let in_place = names_in_place[index as usize];
        let (pos, end) = (file[place].pos, file[place].end);
        let mut written = place;
        while let Some(inside) = (file.member_key(written).map(|it| it.0))
            .or_else(|| file.type_assertion_operand(written))
        {
            file[written].kind = ExprKind::Missing;
            written = inside;
        }
        // Without a parent, it still tells that the file is an ES module.
        match file[written].kind {
            ExprKind::ImportMeta if written == place => {
                _ = file.expr(ExprKind::ImportMeta, pos, end)
            }
            ExprKind::ImportMeta => {}
            _ => file[written].kind = ExprKind::Missing,
        }
        let room = written.0 - in_place.members.len() as u32..;
        let mut name_before_end =
            u16::from(u8::try_from(end.saturating_sub(pos)).unwrap_or(u8::MAX));
        let mut kind = ExprKind::Ident(in_place.first_name);
        let mut flags = ExprFlags::WRITTEN_BY_DEFINE | ExprFlags::PATH_OF_DEFINE;
        for (&name, obj) in in_place.members.iter().zip(room.map(ExprId)) {
            file[obj] = Expr { kind, pos, end };
            file.expr_flags[obj.idx()] = std::mem::take(&mut flags);
            // The message of an error is found by the position of the name in front of what fails.
            name_before_end = name_before_end.saturating_sub(1).max(1);
            kind = ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                name_before_end,
            };
        }
        file[place].kind = kind;
        file.expr_flags[place.idx()] &= ExprFlags::PARENTHESIZED;
        file.add_flags(place, flags | ExprFlags::PATH_OF_DEFINE);
    }
    file.rare_syntax |= rare::PATH_OF_DEFINE;
    file.mentioned.clear();
    (*hir, _) = file.into_arena(arena, atoms.session());
    hir.finish_nodes();
}
