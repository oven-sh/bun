use bun_sema::check::aot::ShapeKind;

use crate::lower::{CheckerTypeId, FileLowering};

// Few types have an index signature, so that is asked before the names of the members.
fn compute_is_dictionary_type(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return false;
    };
    if !matches!(shape.kind, ShapeKind::Object) {
        return false;
    }
    let Ok(signatures) = file.queries.index_signatures(ty) else {
        return false;
    };
    if signatures.is_empty() {
        return false;
    }
    let members = file.queries.member_presence(ty);
    members.is_ok_and(|members| members.is_empty())
}

// The keys of `Record<string, Item>` are data: no name is known at build time, so a layout would have no field. It asks the
// checker alone, because the search for the layout of a type asks it.
pub(in crate::lower) fn is_dictionary_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    if let Some(&is_dictionary) = file.layouts.dictionaries.get(&ty) {
        return is_dictionary;
    }
    let is_dictionary = compute_is_dictionary_type(file, ty);
    file.layouts.dictionaries.insert(ty, is_dictionary);
    is_dictionary
}
