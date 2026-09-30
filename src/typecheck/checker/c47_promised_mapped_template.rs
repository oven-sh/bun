// checker.go:29042-29447 (layer K-TEMPLATE): the functions of 29268-29344: template literal type construction.
use crate::checker::{Checker, TypeFlags, TypeId, get_template_type_key};
use crate::core::{List, Text};
use crate::evaluator::any_to_string;
use crate::stringutil::combine_surrogate_pairs;

impl<'a> Checker<'a> {
    pub fn get_template_literal_type(
        &mut self,
        texts: &[&[u8]],
        types: List<'_, TypeId>,
    ) -> TypeId {
        // The spans of one list: literal parts are folded into the text, nested template literals are flattened, generic and placeholder parts stay. Upstream writes this as a closure over the builder and the two new lists.
        fn add_spans(
            c: &mut Checker<'_>,
            texts: &[&[u8]],
            types: &[TypeId],
            new_types: &mut Vec<TypeId>,
            new_texts: &mut Vec<Vec<u8>>,
            sb: &mut Vec<u8>,
        ) -> bool {
            for (i, &t) in types.iter().enumerate() {
                let flags = c.types[t].flags;
                let next_text: &[u8] = texts.get(i + 1).copied().unwrap_or(b"");
                if flags.intersects(TypeFlags::LITERAL | TypeFlags::NULL | TypeFlags::UNDEFINED) {
                    sb.extend_from_slice(&c.get_template_string_for_type(t));
                    sb.extend_from_slice(next_text);
                } else if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
                    let nested_texts = c.as_template_literal_type(t).texts.as_slice();
                    let nested_types = c.as_template_literal_type(t).types.as_slice();
                    sb.extend_from_slice(nested_texts.first().copied().unwrap_or(b""));
                    if !add_spans(c, nested_texts, nested_types, new_types, new_texts, sb) {
                        return false;
                    }
                    sb.extend_from_slice(next_text);
                } else if c.is_generic_index_type(t) || c.is_pattern_literal_placeholder_type(t) {
                    new_types.push(t);
                    new_texts.push(combine_surrogate_pairs(sb).into_owned());
                    sb.clear();
                    sb.extend_from_slice(next_text);
                } else {
                    return false;
                }
            }
            true
        }
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let type_list = types.as_slice();
        let union_index = type_list.iter().position(|&t| {
            self.types[t]
                .flags
                .intersects(TypeFlags::NEVER | TypeFlags::UNION)
        });
        if let Some(union_index) = union_index {
            if !self.check_cross_product_union(types) {
                return self.error_type;
            }
            let union_type = type_list.get(union_index).copied().unwrap_or(TypeId::NIL);
            return self.map_type(union_type, &mut |c, t| {
                let mut replaced: Vec<TypeId> = type_list.to_vec();
                if let Some(slot) = replaced.get_mut(union_index) {
                    *slot = t;
                }
                c.get_template_literal_type(texts, List::from_slice(&replaced))
            });
        }
        if type_list.contains(&self.wildcard_type) {
            return self.wildcard_type;
        }
        let mut new_types: Vec<TypeId> = Vec::new();
        let mut new_texts: Vec<Vec<u8>> = Vec::new();
        let mut sb: Vec<u8> = Vec::new();
        sb.extend_from_slice(texts.first().copied().unwrap_or(b""));
        if !add_spans(
            self,
            texts,
            type_list,
            &mut new_types,
            &mut new_texts,
            &mut sb,
        ) {
            return self.string_type;
        }
        if new_types.is_empty() {
            let text = self.text(&combine_surrogate_pairs(&sb));
            return self.get_string_literal_type(text);
        }
        new_texts.push(combine_surrogate_pairs(&sb).into_owned());
        if new_texts.iter().all(|t| t.is_empty()) {
            if new_types
                .iter()
                .all(|&t| self.types[t].flags.intersects(TypeFlags::STRING))
            {
                return self.string_type;
            }
            // Normalize `${Mapping<xxx>}` into Mapping<xxx>
            if let [only] = new_types.as_slice() {
                if self.is_pattern_literal_type(*only) {
                    return *only;
                }
            }
        }
        // The key is made from the local lists: the texts and types are copied into the arena only for a new type.
        let text_views: Vec<&[u8]> = new_texts.iter().map(Vec::as_slice).collect();
        let key =
            get_template_type_key(List::from_slice(&text_views), List::from_slice(&new_types));
        let mut t = self.template_literal_types.get(&key);
        if t.is_nil() {
            let stored_texts: Vec<Text<'a>> =
                new_texts.iter().map(|text| self.text(text)).collect();
            let stored_texts = self.list_of(&stored_texts);
            let stored_types = self.list_of(&new_types);
            t = self.new_template_literal_type(stored_texts, stored_types);
            let ok = self.template_literal_types.set(key, t);
            self.map_set(ok);
        }
        t
    }

    pub fn get_template_string_for_type(&self, t: TypeId) -> Vec<u8> {
        let flags = self.types[t].flags;
        if flags.intersects(
            TypeFlags::STRING_LITERAL
                | TypeFlags::NUMBER_LITERAL
                | TypeFlags::BOOLEAN_LITERAL
                | TypeFlags::BIG_INT_LITERAL,
        ) {
            return any_to_string(&self.as_literal_type(t).value);
        }
        if flags.intersects(TypeFlags::NULLABLE) {
            return self.as_intrinsic_type(t).intrinsic_name.to_vec();
        }
        Vec::new()
    }
}
