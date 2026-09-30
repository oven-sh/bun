// checker/jsdoc.go (layer D-JSDOC): JSDoc @param tags that match no parameter.
use crate::ast::{
    Arg, Ast, Kind, NodeFlags, NodeId, get_next_jsdoc_comment_location, is_binding_pattern,
    is_identifier, is_in_js_file, is_qualified_name,
};
use crate::checker::{Checker, entity_name_to_string};
use crate::collections::Set;
use crate::core::{List, Text};
use crate::diagnostics;

impl<'a> Checker<'a> {
    pub fn check_unmatched_jsdoc_parameters(&mut self, node: NodeId) {
        let a = self.ast;
        let mut jsdoc_parameters: Vec<NodeId> = Vec::new();
        for &tag in get_all_jsdoc_tags(a, node).as_slice() {
            if a.kind(tag) == Kind::JSDocParameterTag {
                let name = a.name(tag);
                if is_identifier(a, name) && a.text(name).is_empty() {
                    continue;
                }
                jsdoc_parameters.push(tag);
            }
        }

        if jsdoc_parameters.is_empty() {
            return;
        }

        let is_js = is_in_js_file(a, node);
        let mut parameters: Set<Text<'a>> = Set::default();
        let mut excluded_parameters: Set<usize> = Set::default();

        for (i, &param) in a.parameters(node).as_slice().iter().enumerate() {
            let name = a.name(param);
            if is_identifier(a, name) {
                parameters.add(a.text(name));
            }
            if is_binding_pattern(a, name) {
                excluded_parameters.add(i);
            }
        }
        if self.contains_arguments_reference(node) {
            if is_js {
                let last_jsdoc_param_index = jsdoc_parameters.len() - 1;
                let last_jsdoc_param = jsdoc_parameters.last().copied().unwrap_or_default();
                let last_jsdoc_param_name = a.name(last_jsdoc_param);
                if last_jsdoc_param.is_nil() || !is_identifier(a, last_jsdoc_param_name) {
                    return;
                }
                if excluded_parameters.has(&last_jsdoc_param_index)
                    || parameters.has(&a.text(last_jsdoc_param_name))
                {
                    return;
                }
                let type_expression = a
                    .as_jsdoc_parameter_or_property_tag(last_jsdoc_param)
                    .type_expression;
                if type_expression.is_nil() || a.type_node(type_expression).is_nil() {
                    return;
                }
                let t = self.get_type_from_type_node(a.type_node(type_expression));
                if self.is_array_type(t) {
                    return;
                }
                self.error(last_jsdoc_param_name, diagnostics::JSDOC_PARAM_TAG_HAS_NAME_0_BUT_THERE_IS_NO_PARAMETER_WITH_THAT_NAME_IT_WOULD_MATCH_ARGUMENTS_IF_IT_HAD_AN_ARRAY_TYPE, &[Arg::Str(a.text(last_jsdoc_param_name))]);
            }
        } else {
            for (index, &tag) in jsdoc_parameters.iter().enumerate() {
                let name = a.name(tag);
                let is_name_first = a.as_jsdoc_parameter_or_property_tag(tag).is_name_first;

                if excluded_parameters.has(&index)
                    || (is_identifier(a, name) && parameters.has(&a.text(name)))
                {
                    continue;
                }

                if is_qualified_name(a, name) {
                    if is_js {
                        let qualified_name = entity_name_to_string(a, name);
                        let left_name = entity_name_to_string(a, a.as_qualified_name(name).left);
                        self.error(
                            name,
                            diagnostics::QUALIFIED_NAME_0_IS_NOT_ALLOWED_WITHOUT_A_LEADING_PARAM_OBJECT_1,
                            &[Arg::Str(&qualified_name), Arg::Str(&left_name)],
                        );
                    }
                } else {
                    if !is_name_first {
                        self.error_or_suggestion(
                            is_js,
                            name,
                            diagnostics::JSDOC_PARAM_TAG_HAS_NAME_0_BUT_THERE_IS_NO_PARAMETER_WITH_THAT_NAME,
                            &[Arg::Str(a.text(name))],
                        );
                    }
                }
            }
        }
    }
}

pub fn get_all_jsdoc_tags<'a>(a: Ast<'a>, node: NodeId) -> List<'a, NodeId> {
    if !a.flags(node).intersects(NodeFlags::JSDOC) {
        let mut current = node;
        while !current.is_nil() {
            let jsdocs = a.jsdoc(current);
            if jsdocs.len() != 0 {
                let last_jsdoc = jsdocs.as_slice().last().copied().unwrap_or_default();
                let tags = a.as_jsdoc(last_jsdoc).tags;
                if !tags.is_nil() {
                    return a.nodes(tags);
                }
            }
            current = get_next_jsdoc_comment_location(a, current);
        }
    }
    List::NIL
}
