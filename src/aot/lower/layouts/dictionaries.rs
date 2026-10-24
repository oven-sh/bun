use bun_sema::check::aot::ShapeKind;

use crate::lower::{CheckerTypeId, FileLowering};

impl FileLowering<'_, '_, '_, '_> {
    // Few types have an index signature, so that is asked before the names of the members.
    fn compute_is_dictionary_type(&mut self, ty: CheckerTypeId) -> bool {
        let Ok(shape) = self.queries.type_shape(ty) else {
            return false;
        };
        if !matches!(shape.kind, ShapeKind::Object) {
            return false;
        }
        let Ok(signatures) = self.queries.index_signatures(ty) else {
            return false;
        };
        if signatures.is_empty() {
            return false;
        }
        let members = self.queries.member_presence(ty);
        members.is_ok_and(|members| members.is_empty())
    }

    // The keys of `Record<string, Item>` are data: no name is known at build time, so a layout would have no field.
    pub(in crate::lower) fn is_dictionary_type(&mut self, ty: CheckerTypeId) -> bool {
        if let Some(&is_dictionary) = self.layouts.dictionaries.get(&ty) {
            return is_dictionary;
        }
        let is_dictionary = self.compute_is_dictionary_type(ty);
        self.layouts.dictionaries.insert(ty, is_dictionary);
        is_dictionary
    }
}
