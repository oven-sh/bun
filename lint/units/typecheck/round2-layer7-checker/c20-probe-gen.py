#!/usr/bin/env python3
# Writes c20-probe.rs beside this script: checker/c20_object_literals_spread.rs and checker/types.rs of the tree by #[path],
# the leaf files they stand on by #[path], and stand-ins for every other name. The signature of a stand-in is read from the
# file of the tree that defines the function, at the time of the run; its body never returns. The callees that no file of
# the tree defines yet are written by hand in the block MISSING below, with upstream's parameter order.
# Run: python3 c20-probe-gen.py && rustc --edition 2024 --crate-type lib --emit=metadata -o /tmp/c20-probe.rmeta c20-probe.rs
# Clippy with the table of the workspace: sh c20-probe-clippy.sh
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = {}


def lines_of(rel):
    if rel not in CACHE:
        with open(os.path.join(ROOT, rel)) as f:
            CACHE[rel] = f.read().split('\n')
    return CACHE[rel]


def fn_sig(rel, name, indent):
    # A name is `name` or `(name, text)`: the text is what the first line of the one wanted definition holds.
    must = ''
    if isinstance(name, tuple):
        name, must = name
    ls = lines_of(rel)
    pat = re.compile(r'^' + ' ' * indent + r'pub(?:\(crate\))? (?:const )?fn ' + re.escape(name) + r'[<(]')
    hits = [i for i, l in enumerate(ls) if pat.match(l) and must in l]
    if len(hits) != 1:
        sys.exit('%s: %s at indent %d: %d definitions' % (rel, name, indent, len(hits)))
    i = hits[0]
    out = []
    while True:
        out.append(ls[i])
        if ls[i].rstrip().endswith('{'):
            break
        i += 1
    text = '\n'.join(out)
    return re.sub(r'(?<![&\w])mut (\w+):', r'\1:', text)


def stub(rel, name, indent):
    return '// %s\n%s\n%sloop {}\n%s}\n' % (rel, fn_sig(rel, name, indent), ' ' * (indent + 4), ' ' * indent)


def block(rel, first, back):
    # The lines of an item: from `back` lines before the line that starts with `first` to the first line that is `}` or ends the macro call.
    ls = lines_of(rel)
    hits = [i for i, l in enumerate(ls) if l.startswith(first)]
    if len(hits) != 1:
        sys.exit('%s: %s: %d items' % (rel, first, len(hits)))
    i = hits[0]
    out = ls[i - back:i]
    while True:
        out.append(ls[i])
        if ls[i] in ('}', '});'):
            break
        i += 1
    return '\n'.join(out) + '\n'


AST_METHODS = [
    ('ast/node_methods.rs', ['symbol', 'name', 'properties', 'initializer', 'type_node', 'expression', 'elements',
                             'parameters', 'arguments', 'text']),
    ('ast/reader.rs', [('kind', '(self, node: NodeId)'), ('parent', '(self, node: NodeId)')]),
    ('ast/symbol.rs', ['sym', 'new_table', 'table_get', 'table_set', 'table_len', 'update_symbol']),
    ('ast/ast_generated.rs', ['as_shorthand_property_assignment', 'as_binary_expression',
                              'as_prefix_unary_expression']),
]
AST_FREE = [
    ('ast/utilities.rs', ['find_ancestor_or_quit', 'get_root_declaration', 'get_this_parameter',
                          'has_syntactic_modifier', 'is_assignment_target', 'is_class_like', 'is_const_assertion',
                          'is_entity_name_expression', 'is_function_like_declaration', 'is_in_js_file',
                          'is_in_json_file', 'is_node_descendant_of', 'is_object_literal_method',
                          'is_private_identifier_class_element_declaration', 'skip_parentheses']),
    ('ast/ast_generated.rs', ['is_array_literal_expression', 'is_binary_expression', 'is_binding_element',
                              'is_call_expression', 'is_computed_property_name', 'is_method_declaration',
                              'is_object_binding_pattern', 'is_object_literal_expression',
                              'is_parameter_declaration', 'is_parenthesized_expression', 'is_property_assignment',
                              'is_shorthand_property_assignment', 'is_spread_element', 'is_template_span',
                              'is_variable_declaration']),
]
AST_RECORDS = ['ShorthandPropertyAssignment', 'BinaryExpression', 'PrefixUnaryExpression']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'assert', 'bad_cast', 'map_set', 'slice_set', 'stack_limit',
                                        'list_of', 'list', 'text', 'same_map', 'concatenate']),
    ('checker/links.rs', ['value_symbol_links_get']),
    ('checker/c05_check_source_file.rs', ['check_node_deferred']),
    ('checker/c14_expressions.rs', ['check_expression', 'check_expression_ex', 'check_expression_cached',
                                    'instantiate_type_with_single_generic_call_signature']),
    ('checker/c21_resolved_symbols_diagnostics.rs', ['error', 'add_deprecated_suggestion', 'is_deprecated_symbol']),
    ('checker/c22_symbols_merge.rs', ['new_symbol', 'new_symbol_ex', 'get_symbol_of_declaration']),
    ('checker/c25_entity_names.rs', ['resolve_entity_name']),
    ('checker/c28_types_of_symbols.rs', ['get_type_of_symbol']),
    ('checker/c29_constraints.rs', ['get_constraint_of_conditional_type']),
    ('checker/c31_binding_patterns_widening.rs', ['add_optionality_ex', 'get_combined_node_flags_cached',
                                                  'get_declaration_node_flags_from_symbol',
                                                  'get_type_for_binding_element_parent',
                                                  'get_binding_element_type_from_parent_type']),
    ('checker/c33_members_base_types_signatures.rs', ['get_object_literal_index_info', 'get_property_of_type',
                                                      'get_index_info_of_type', 'get_index_infos_of_type',
                                                      'get_index_type_of_type', 'get_properties_of_type',
                                                      'get_type_of_property_of_type']),
    ('checker/c36_properties_apparent_types.rs', ['get_reduced_type', 'get_reduced_apparent_type']),
    ('checker/c37_instantiation.rs', ['get_homomorphic_type_variable', 'instantiate_type']),
    ('checker/c38_type_nodes_references.rs', ['get_element_types', 'get_type_from_type_node']),
    ('checker/c40_type_nodes_conditional_tuples.rs', ['is_generic_object_type', 'is_generic_mapped_type',
                                                      'is_generic_tuple_type']),
    ('checker/c41_new_types.rs', ['new_anonymous_type', 'new_index_info']),
    ('checker/c42_literal_types.rs', ['map_type', 'get_regular_type_of_literal_type',
                                      'get_widened_literal_like_type_for_contextual_type',
                                      'get_number_literal_type']),
    ('checker/c43_unions_intersections.rs', ['is_error_type', 'check_cross_product_union', 'is_empty_object_type',
                                             'get_intersection_type', 'get_union_type', 'get_union_type_ex']),
    ('checker/c44_index_indexed_access.rs', ['check_computed_property_name', 'get_indexed_access_type']),
    ('checker/c45_base_constraints_normalization.rs', ['get_base_constraint_or_type']),
    ('checker/c47_promised_mapped_template.rs', ['remove_missing_or_undefined_type']),
    ('checker/flow.rs', ['is_some_symbol_assigned', 'get_flow_type_of_reference_ex']),
    ('checker/grammarchecks.rs', ['check_grammar_object_literal_expression', 'check_grammar_method']),
    ('checker/printer.rs', ['symbol_to_string', 'type_to_string_exported']),
    ('checker/relater.rs', ['is_type_assignable_to', 'check_type_assignable_to_and_optionally_elaborate']),
    ('checker/utilities.rs', ['new_diagnostic_for_node', 'is_canceled']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', ['get_declaration_modifier_flags_from_symbol', 'get_property_name_from_type',
                              'has_dot_dot_dot_token', 'is_type_assertion', 'is_type_usable_as_property_name',
                              'value_to_string']),
    ('checker/c28_types_of_symbols.rs', ['signature_has_rest_parameter']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
    ('checker/c42_literal_types.rs', ['get_boolean_literal_value']),
    ('checker/c43_unions_intersections.rs', ['every_type']),
    ('checker/flow.rs', ['get_flow_node_of_node']),
]
CORE_FREE = ['some', 'every', 'find', 'find_index', 'if_else']

# The callees of c20 that no file of the tree defines: upstream's name in snake_case, upstream's parameter order, an id for a pointer.
MISSING = '''
        pub fn push_cached_contextual_type(&mut self, node: NodeId) {
            loop {}
        }
        pub fn pop_contextual_type(&mut self) {
            loop {}
        }
        pub fn get_apparent_type_of_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
        pub fn get_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
        pub fn instantiate_contextual_type(&mut self, contextual_type: TypeId, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
        pub fn is_context_sensitive(&mut self, node: NodeId) -> bool {
            loop {}
        }
        pub fn is_context_sensitive_function_or_object_literal_method(&mut self, func: NodeId) -> bool {
            loop {}
        }
        pub fn get_inference_context(&mut self, node: NodeId) -> InferenceContextId {
            loop {}
        }
        pub fn add_intra_expression_inference_site(&mut self, n: InferenceContextId, node: NodeId, t: TypeId) {
            loop {}
        }
        pub fn remove_definitely_falsy_types(&mut self, t: TypeId) -> TypeId {
            loop {}
        }
        pub fn get_control_flow_container(&mut self, node: NodeId) -> NodeId {
            loop {}
        }
        pub fn get_contextual_signature(&mut self, node: NodeId) -> SignatureId {
            loop {}
        }
        pub fn check_function_expression_or_object_literal_method(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
            loop {}
        }
'''


def path_mod(rel, name=None):
    name = name or os.path.basename(rel)[:-3]
    return '#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name)


out = []
w = out.append
w('''//! Probe of checker/c20_object_literals_spread.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by c20-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: diagnostics/, core/{arena,golang,linkstore,text,tristate,tristate_stringer_generated}.rs, collections/{set,ordered_map,ordered_set}.rs, jsnum/jsnum.rs, ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs, checker/types.rs.
//! Run: rustc --edition 2024 --crate-type lib --emit=metadata -o /tmp/c20-probe.rmeta c20-probe.rs
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unreachable_pub, unused_assignments)]

''')
w(path_mod('diagnostics/mod.rs', 'diagnostics'))
w('\npub mod core {\n')
for rel in ['core/arena.rs', 'core/golang.rs', 'core/linkstore.rs', 'core/text.rs', 'core/tristate.rs',
            'core/tristate_stringer_generated.rs']:
    w(path_mod(rel))
w('''pub use golang::*;
pub use linkstore::*;
pub use text::*;
pub use tristate::*;

// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 223-268: `map[K]V` that nothing ranges over.
pub struct Map<K, V>(Option<std::collections::BTreeMap<K, V>>);
impl<K, V> Default for Map<K, V> {
    fn default() -> Self {
        Self(None)
    }
}
impl<K: Ord + Copy, V: Copy + Default> Map<K, V> {
    pub fn make() -> Self {
        Self(Some(std::collections::BTreeMap::new()))
    }
    pub fn is_nil(&self) -> bool {
        self.0.is_none()
    }
    pub fn get(&self, key: &K) -> V {
        self.get_ok(key).unwrap_or_default()
    }
    pub fn get_ok(&self, key: &K) -> Option<V> {
        self.0.as_ref().and_then(|m| m.get(key)).copied()
    }
    #[must_use]
    pub fn set(&mut self, key: K, value: V) -> bool {
        match self.0.as_mut() {
            Some(m) => {
                m.insert(key, value);
                true
            }
            None => false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Debug)]
pub struct ScriptTarget(pub i32);
impl ScriptTarget {
    pub const ES2016: Self = Self(3);
    pub const ES2017: Self = Self(4);
    pub const ES2018: Self = Self(5);
    pub const ES2019: Self = Self(6);
    pub const ES2020: Self = Self(7);
    pub const ES2021: Self = Self(8);
    pub const ES2022: Self = Self(9);
    pub const ES_NEXT: Self = Self(99);
}

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
''')
for name in CORE_FREE:
    sig = fn_sig('core/core.rs', name, 0)
    w('// core/core.rs\n%s\n    loop {}\n}\n' % sig)
w('}\npub use stand_ins::*;\n}\n\n')

w('pub mod collections {\n')
for rel in ['collections/ordered_map.rs', 'collections/ordered_set.rs', 'collections/set.rs']:
    w(path_mod(rel))
w('pub use ordered_map::*;\npub use ordered_set::*;\npub use set::*;\n}\n\n')

w('pub mod jsnum {\n')
w(path_mod('jsnum/jsnum.rs'))
w('''pub use jsnum::*;
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct PseudoBigInt {
    pub negative: bool,
    pub base10_value: Vec<u8>,
}
}

pub mod evaluator {
    #[derive(Default)]
    pub struct Result<'a> {
        pub marker: std::marker::PhantomData<&'a ()>,
    }
}

pub mod ast {
''')
for rel in ['ast/flags.rs', 'ast/ids.rs', 'ast/checkflags.rs', 'ast/symbolflags.rs', 'ast/modifierflags.rs',
            'ast/nodeflags.rs', 'ast/kind_generated.rs', 'ast/diagnostic.rs']:
    w(path_mod(rel))
w('''pub use checkflags::*;
pub use diagnostic::*;
pub use ids::*;
pub use kind_generated::*;
pub use modifierflags::*;
pub use nodeflags::*;
pub use symbolflags::*;

use crate::core::List;

''')
w('// ast/symbol.rs\n')
w('pub type SymbolTable = SymbolTableId;\n')
w(block('ast/symbol.rs', 'pub struct Symbol<', 1))
w('// ast/ast_generated.rs\n')
for name in AST_RECORDS:
    w(block('ast/ast_generated.rs', 'pub struct %s {' % name, 1))
w('// ast/utilities.rs\n')
w(block('ast/utilities.rs', 'pub struct FindAncestorResult(', 2))
w('''
// Invariant in its lifetime, as the context of the tree is: it names stores with interior mutability.
#[derive(Clone, Copy)]
pub struct Ast<'a> {
    pub marker: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
}

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use super::*;

    impl<'a> Ast<'a> {
''')
for rel, names in AST_METHODS:
    for name in names:
        w(stub(rel, name, 4))
w('    }\n\n')
for rel, names in AST_FREE:
    for name in names:
        w(stub(rel, name, 0))
w('}\npub use stand_ins::*;\n}\n\n')

w('pub mod checker {\n')
w(path_mod('checker/types.rs'))
w(path_mod('checker/c20_object_literals_spread.rs'))
w('''pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{
        Arg, Ast, DiagnosticId, DiagnosticStore, FlowNodeId, ModifierFlags, NodeFlags, NodeId,
        SymbolFlags, SymbolId, SymbolTableId, CheckFlags,
    };
    use crate::checker::types::checker_flags;
    use crate::checker::types::*;
    use crate::core::{Link, LinkStore, List, Map, Text};
    use crate::diagnostics::MessageId;
    use crate::jsnum::Number;

    // checker.go:17471: the key of a cache, which no file of the tree defines.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
    pub struct CacheHashKey(pub u128);

    // bun_core::StackCheck
    #[derive(Clone, Copy, Default)]
    pub struct StackCheck;
    impl StackCheck {
        pub fn is_safe_to_recurse(self) -> bool {
            true
        }
    }

    // checker/c01_data.rs
''')
for name in ['CheckMode', 'UnionReduction', 'IntersectionState']:
    w(block('checker/c01_data.rs', 'checker_flags!(%s:' % name, 0))
w('''
    // checker/c01_data.rs 312: the field that c20 reads.
    #[derive(Default)]
    pub struct InferenceContext {
        pub non_fixing_mapper: TypeMapperId,
    }

    // checker/c02_program_checker.rs 122 and 226: the bounds of the lists and of the fallbacks.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for TypeId {}
    impl<'a> ListItem<'a> for SymbolId {}
    impl<'a> ListItem<'a> for NodeId {}
    impl<'a> ListItem<'a> for SignatureId {}
    impl<'a> ListItem<'a> for IndexInfoId {}
    pub trait Fallback<'a>: Sized {
        fn fallback(c: &Checker<'a>) -> Self;
    }
    impl<'a> Fallback<'a> for () {
        fn fallback(_: &Checker<'a>) -> Self {}
    }
    macro_rules! fallback_default {
        ($($ty:ty),* $(,)?) => {$(
            impl<'a> Fallback<'a> for $ty {
                fn fallback(_: &Checker<'a>) -> Self {
                    <$ty>::default()
                }
            }
        )*};
    }
    fallback_default!(bool, isize, usize, NodeId, SymbolId, TypeMapperId, IndexInfoId);
    impl<'a> Fallback<'a> for TypeId {
        fn fallback(c: &Checker<'a>) -> Self {
            c.error_type
        }
    }
    impl<'a, T: Copy + Default> Fallback<'a> for List<'a, T> {
        fn fallback(_: &Checker<'a>) -> Self {
            List::NIL
        }
    }

    // checker/c02_program_checker.rs 379-731: the fields that c20 and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
        pub stack_check: StackCheck,
        pub types: Records<TypeId, Type<'a>>,
        pub type_aliases: Records<TypeAliasId, TypeAlias<'a>>,
        pub inference_contexts: Records<InferenceContextId, InferenceContext>,
        pub nil_sections: NilSections<'a>,
        pub sink_sections: NilSections<'a>,
        pub diagnostic_store: DiagnosticStore,
        pub strict_null_checks: bool,
        pub signatures: Records<SignatureId, Signature<'a>>,
        pub index_infos: Records<IndexInfoId, IndexInfo<'a>>,
        pub node_links: LinkStore<NodeId, NodeLinks>,
        pub value_symbol_links: LinkStore<SymbolId, ValueSymbolLinks>,
        pub mapped_symbol_links: LinkStore<SymbolId, MappedSymbolLinks>,
        pub spread_links: LinkStore<SymbolId, SpreadLinks>,
        pub pattern_for_type: Map<TypeId, NodeId>,
        pub any_type: TypeId,
        pub error_type: TypeId,
        pub unknown_type: TypeId,
        pub undefined_type: TypeId,
        pub string_type: TypeId,
        pub number_type: TypeId,
        pub es_symbol_type: TypeId,
        pub never_type: TypeId,
        pub string_number_symbol_type: TypeId,
        pub empty_object_type: TypeId,
    }

    impl<'a> Checker<'a> {
''')
for rel, names in CHECKER_METHODS:
    for name in names:
        w(stub(rel, name, 4))
w('        // No file of the tree defines these yet.\n')
w(MISSING)
w('    }\n\n')
for rel, names in CHECKER_FREE:
    for name in names:
        w(stub(rel, name, 0))
w('}\n}\n')

with open(os.path.join(HERE, 'c20-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('c20-probe.rs: %d lines' % ''.join(out).count('\n'))
