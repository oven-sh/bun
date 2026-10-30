use bun_sema::check::aot::ShapeKind;

use crate::lower::{CheckerTypeId, FileLowering};

impl FileLowering<'_, '_, '_, '_> {
    // The keys of `Record<string, Item>` are data: no name is known at build time, so a layout would have no field.
    pub(in crate::lower) fn is_dictionary_type(&mut self, ty: CheckerTypeId) -> bool {
        if let Some(&is_dictionary) = self.layouts.dictionaries.get(&ty) {
            return is_dictionary;
        }
        let shape = self.queries.type_shape(ty);
        let is_dictionary = shape.is_ok_and(|shape| matches!(shape.kind, ShapeKind::Object))
            && matches!(self.queries.index_signatures(ty), Ok(signatures) if !signatures.is_empty())
            && matches!(self.queries.member_presence(ty), Ok(members) if members.is_empty());
        self.layouts.dictionaries.insert(ty, is_dictionary);
        is_dictionary
    }
}
