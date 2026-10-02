#!/usr/bin/env python3
# Writes c18-probe.rs into a work directory: checker/c18_identifiers_property_access_this.rs, checker/types.rs and
# checker/c01_data.rs of the tree by #[path], the leaf files they stand on by #[path], and stand-ins for every other
# name. The signature of a stand-in is read from the file of the tree that defines the function, at the time of the
# run; its body never returns. The three callees that no file of the tree defines yet (the ranges of c16, c45 and c48)
# are written by hand in the block MISSING, with upstream's parameter order: when the file of their range has them,
# the signature of the tree replaces the hand-written one. Map and LiveList of crate::core are the contract's, until
# the tree has them. After the file come its consumers: the calls that other files of checker/ make into its
# functions, with the arguments and the use of the result that the tree writes.
# The layout of this script is the one of c04-probe-gen.py.
# Run: sh c18-probe.sh
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/c18probe-run'
FILE = 'checker/c18_identifiers_property_access_this.rs'
CACHE = {}


def lines_of(rel):
    if rel not in CACHE:
        with open(os.path.join(ROOT, rel)) as f:
            CACHE[rel] = f.read().split('\n')
    return CACHE[rel]


def find_sig(rel, name, indent):
    # A name is `name` or `(name, text)`: the text is what the first line of the one wanted definition holds.
    must = ''
    if isinstance(name, tuple):
        name, must = name
    ls = lines_of(rel)
    pat = re.compile(r'^' + ' ' * indent + r'pub(?:\(crate\))? (?:const )?fn ' + re.escape(name) + r'[<(]')
    hits = [i for i, l in enumerate(ls) if pat.match(l) and must in l]
    if len(hits) != 1:
        return None, len(hits)
    i = hits[0]
    out = []
    while True:
        out.append(ls[i])
        if ls[i].rstrip().endswith('{'):
            break
        i += 1
    text = '\n'.join(out)
    return re.sub(r'(?<![&\w])mut (\w+):', r'\1:', text), 1


def fn_sig(rel, name, indent):
    sig, count = find_sig(rel, name, indent)
    if sig is None:
        sys.exit('%s: %s at indent %d: %d definitions' % (rel, name, indent, count))
    return sig


def stub(rel, name, indent):
    return '// %s\n%s\n%sloop {}\n%s}\n' % (rel, fn_sig(rel, name, indent), ' ' * (indent + 4), ' ' * indent)


def whole_fn(rel, name, indent):
    # The function as the tree has it: from its first line to the line that closes it.
    ls = lines_of(rel)
    pat = re.compile(r'^' + ' ' * indent + r'pub fn ' + re.escape(name) + r'[<(]')
    hits = [i for i, l in enumerate(ls) if pat.match(l)]
    if len(hits) != 1:
        sys.exit('%s: %s at indent %d: %d definitions' % (rel, name, indent, len(hits)))
    i = hits[0]
    out = []
    while True:
        out.append(ls[i])
        if ls[i] == ' ' * indent + '}':
            break
        i += 1
    return '// %s\n%s\n' % (rel, '\n'.join(out))


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
        if ls[i] in ('}', '});') or (ls[i].endswith(';') and i == hits[0]):
            break
        i += 1
    return '\n'.join(out) + '\n'


def line(rel, first):
    # The one line that starts with `first`: the same line in two records of a file counts as one.
    hits = sorted(set(l for l in lines_of(rel) if l.startswith(first)))
    if len(hits) != 1:
        sys.exit('%s: %s: %d lines' % (rel, first, len(hits)))
    return hits[0] + '\n'


AST_METHODS = [
    ('ast/node_methods.rs', ['symbol', 'name', 'text', 'expression', 'body', 'initializer', 'type_node',
                             'postfix_token', 'modifier_flags', 'has_flow_node_data', 'flow_node']),
    ('ast/reader.rs', [('kind', '(self, node: NodeId)'), ('parent', '(self, node: NodeId)'),
                       ('loc', '(self, node: NodeId)'), ('pos', '(self, node: NodeId)'),
                       ('flags', '(self, node: NodeId)'), 'as_source_file']),
    ('ast/symbol.rs', ['sym', 'table_get']),
    ('ast/ast_generated.rs', ['as_variable_declaration', 'as_property_access_expression', 'as_qualified_name',
                              'as_binary_expression', 'as_type_reference_node']),
]
AST_FREE = [
    ('ast/utilities.rs', [
        'find_ancestor', 'find_ancestor_or_quit', 'get_class_extends_heritage_element',
        'get_class_like_declaration_of_symbol', 'get_containing_class',
        'get_immediately_invoked_function_expression', 'get_name_of_declaration', 'get_reparsed_node_for_node',
        'get_root_declaration', 'get_source_file_of_node', 'get_this_container', 'get_this_parameter',
        'has_accessor_modifier', 'has_decorators', 'has_static_modifier', 'is_access_expression',
        'is_assignment_expression', 'is_assignment_target', 'is_call_like_expression',
        'is_call_or_new_expression', 'is_class_element', 'is_class_like', 'is_entity_name_expression',
        'is_for_in_or_of_statement', 'is_function_expression_or_arrow_function', 'is_function_like',
        'is_function_like_declaration', 'is_in_js_file', 'is_jsdoc_name_reference_context',
        'is_node_descendant_of', 'is_object_literal_or_class_expression_method_or_accessor',
        'is_optional_chain', 'is_plain_js_file', 'is_private_identifier_class_element_declaration',
        'is_question_token', 'is_static', 'is_this_in_type_query', 'node_is_present',
        'walk_up_parenthesized_expressions']),
    ('ast/ast_generated.rs', [
        'is_arrow_function', 'is_binary_expression', 'is_binding_element', 'is_class_declaration',
        'is_computed_property_name', 'is_constructor_declaration', 'is_identifier', 'is_interface_declaration',
        'is_js_type_alias_declaration', 'is_method_declaration', 'is_module_block', 'is_non_null_expression',
        'is_object_binding_pattern', 'is_parameter_declaration', 'is_parenthesized_expression',
        'is_private_identifier', 'is_property_access_expression', 'is_property_declaration', 'is_source_file',
        'is_spread_assignment', 'is_type_alias_declaration', 'is_type_literal_node', 'is_type_reference_node',
        'is_variable_declaration']),
    ('ast/ast.rs', ['is_write_access', 'is_write_only_access']),
    ('ast/symbol.rs', ['symbol_name']),
]
AST_RECORDS = ['VariableDeclaration', 'PropertyAccessExpression', 'QualifiedName', 'BinaryExpression',
               'TypeReferenceNode']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'bad_cast', 'stack_limit', 'list_of', 'filter']),
    ('checker/c04_name_resolution_hooks.rs', ['get_spelling_suggestion_for_name',
                                              'is_block_scoped_name_declared_before_use']),
    ('checker/c09_check_classes_interfaces.rs', ['is_property_without_initializer']),
    ('checker/c14_expressions.rs', ['check_expression', 'check_expression_cached', 'check_non_null_expression',
                                    'check_non_null_type']),
    ('checker/c20_object_literals_spread.rs', ['is_in_property_initializer_or_class_static_block',
                                               'get_narrowed_type_of_symbol', 'is_readonly_symbol']),
    ('checker/c21_resolved_symbols_diagnostics.rs', [
        'add_deferred_diagnostic', 'add_deprecated_suggestion', 'add_error_or_suggestion', 'error',
        'get_resolved_symbol', 'get_resolved_symbol_or_nil', 'is_deprecated_declaration', 'is_deprecated_symbol']),
    ('checker/c22_symbols_merge.rs', ['create_diagnostic_for_node',
                                      'get_export_symbol_of_value_symbol_if_exported', 'get_parent_of_symbol',
                                      'get_symbol_of_declaration']),
    ('checker/c25_entity_names.rs', ['resolve_entity_name']),
    ('checker/c27_resolve_alias.rs', ['resolve_alias_with_deprecation_check', 'get_declaration_of_alias_symbol']),
    ('checker/c28_types_of_symbols.rs', ['check_declaration_initializer', 'get_base_constructor_type_of_class',
                                         'get_type_of_symbol', 'get_write_type_of_symbol']),
    ('checker/c29_constraints.rs', ['get_constraint_of_type_parameter']),
    ('checker/c31_binding_patterns_widening.rs', ['add_optionality_ex', 'get_combined_modifier_flags_cached',
                                                  'get_non_nullable_type', 'get_optional_type',
                                                  'get_widened_type']),
    ('checker/c32_type_resolution.rs', ['pop_type_resolution', 'push_type_resolution',
                                        'report_circularity_error']),
    ('checker/c33_members_base_types_signatures.rs', [
        'get_applicable_index_info_for_name', 'get_base_types', 'get_properties_of_type', 'get_property_of_type',
        'get_property_of_type_ex', 'get_signature_from_declaration', 'get_type_of_property_of_type',
        'has_base_type']),
    ('checker/c34_return_types.rs', ['get_signature_of_full_signature_type']),
    ('checker/c36_properties_apparent_types.rs', ['elaborate_never_intersection', 'get_apparent_type']),
    ('checker/c37_instantiation.rs', ['instantiate_type']),
    ('checker/c38_type_nodes_references.rs', ['get_declared_type_of_symbol', 'get_type_from_type_node']),
    ('checker/c40_type_nodes_conditional_tuples.rs', ['is_generic_object_type']),
    ('checker/c42_literal_types.rs', ['get_base_type_of_literal_type']),
    ('checker/c43_unions_intersections.rs', ['get_union_type', 'is_empty_object_type', 'is_error_type']),
    ('checker/c44_index_indexed_access.rs', ['is_assignment_to_readonly_entity', 'is_auto_typed_property',
                                             'is_self_type_access', 'is_this_property_access_in_constructor',
                                             'type_has_static_property']),
    ('checker/c45_base_constraints_normalization.rs', ['contains_undefined_type', 'get_base_constraint_of_type']),
    ('checker/c46_mark_references.rs', ['check_external_emit_helpers', 'mark_linked_references']),
    ('checker/c47_promised_mapped_template.rs', ['get_optional_expression_type', 'get_promised_type_of_promise',
                                                 'propagate_optional_type_marker', 'remove_missing_type']),
    ('checker/c50_contextual_properties_inference_context.rs', ['get_apparent_type_of_contextual_type',
                                                                'get_inference_context']),
    ('checker/c51_type_facts_awaited.rs', ['convert_auto_to_any', 'get_type_with_facts', 'has_type_facts']),
    ('checker/c52_symbol_at_location.rs', ['get_this_type_of_object_literal_from_contextual_type']),
    ('checker/flow.rs', [
        'get_flow_type_of_reference', 'get_flow_type_of_reference_ex', 'get_narrowable_type_for_reference',
        'has_matching_argument', 'is_destructuring_assignment_target', 'is_evolving_array_operation_target',
        'is_past_last_assignment', 'is_post_super_flow_node', 'is_symbol_assigned_definitely']),
    ('checker/grammarchecks.rs', ['grammar_error_on_node']),
    ('checker/inference.rs', ['get_mapper_from_context']),
    ('checker/printer.rs', ['symbol_to_string', 'symbol_to_string_exported', 'type_to_string_exported']),
    ('checker/relater.rs', ['for_each_property', 'get_declaring_class', 'get_this_type_of_signature']),
    ('checker/utilities.rs', ['is_constant_variable', 'is_js_literal_type',
                              'is_mutable_local_variable_declaration', 'is_parameter_or_mutable_local_variable',
                              'is_unchecked_js_suggestion', 'new_diagnostic_chain_for_node',
                              'new_diagnostic_for_node']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', [
        'get_assignment_target_kind', 'get_binding_element_property_name',
        'get_containing_class_excluding_class_decorators', 'get_containing_object_literal',
        'get_declaration_modifier_flags_from_symbol_ex', 'get_feature_map', 'is_class_instance_property',
        'is_delete_target', 'is_in_compound_like_assignment', 'is_in_type_query',
        'is_this_initialized_declaration', 'is_this_initialized_object_binding_expression', 'is_this_property',
        'is_this_type_parameter', 'is_type_any', 'value_to_string']),
    ('checker/c33_members_base_types_signatures.rs', ['get_target_type']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
    ('checker/c43_unions_intersections.rs', ['every_contained_type']),
    ('checker/c45_base_constraints_normalization.rs', ['is_const_enum_object_type']),
    ('checker/c46_mark_references.rs', ['should_mark_identifier_alias_referenced']),
]
# The functions of core/core.rs that the file calls: they stand alone, so they are the text of the tree.
CORE_WHOLE = ['some', 'every', 'if_else']

# The callees of c18 that no file of the tree defined when this was written: upstream's name in snake_case, upstream's parameter order, an id for a pointer.
MISSING = {
    'mark_property_as_referenced': '''
        pub fn mark_property_as_referenced(&mut self, prop: SymbolId, node_for_check_write_only: NodeId, is_self_type_access: bool) {
            loop {}
        }
''',
    'is_context_sensitive_function_or_object_literal_method': '''
        pub fn is_context_sensitive_function_or_object_literal_method(&mut self, func: NodeId) -> bool {
            loop {}
        }
''',
    'get_contextual_signature': '''
        pub fn get_contextual_signature(&mut self, node: NodeId) -> SignatureId {
            loop {}
        }
''',
}
# Where a callee of MISSING lands by its upstream range.
MISSING_HOME = {
    'mark_property_as_referenced': 'checker/c45_base_constraints_normalization.rs',
    'is_context_sensitive_function_or_object_literal_method': 'checker/c48_contextual_types.rs',
    'get_contextual_signature': 'checker/c16_function_expressions_collisions.rs',
}


def path_mod(rel, name=None):
    name = name or os.path.basename(rel)[:-3]
    return '#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name)


out = []
w = out.append
w('''//! Probe of checker/c18_identifiers_property_access_this.rs: the file of the tree, by #[path], beside stand-ins for what it names and the consumers of its functions. Written by c18-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: diagnostics/, internal.rs, core/{arena,golang,linkstore,text,tristate}.rs, collections/{set,ordered_map,ordered_set}.rs, ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs, checker/{types,c01_data}.rs.
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unreachable_pub, unused_assignments)]

''')
w(path_mod('diagnostics/mod.rs', 'diagnostics'))
w(path_mod('internal.rs', 'internal'))
w('\npub mod core {\n')
for rel in ['core/arena.rs', 'core/golang.rs', 'core/linkstore.rs', 'core/text.rs', 'core/tristate.rs']:
    w(path_mod(rel))
w('''pub use golang::*;
pub use linkstore::*;
pub use text::*;
pub use tristate::*;
''')
golang = '\n'.join(lines_of('core/golang.rs'))
if 'pub struct LiveList' not in golang:
    w('''
// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 152-220: a `[]T` that upstream writes after it shared it.
pub struct LiveList<'a, T>(Option<&'a [std::cell::Cell<T>]>);

impl<T> Clone for LiveList<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for LiveList<'_, T> {}
impl<T> Default for LiveList<'_, T> {
    fn default() -> Self {
        Self(None)
    }
}
''')
if 'pub struct Map' not in golang:
    w('''
// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 222-270: `map[K]V` that nothing ranges over. The map of std stands for the contract's, with the same variance.
#[allow(clippy::disallowed_types)]
mod map {
    use std::collections::HashMap;

    pub struct Map<K, V>(Option<HashMap<K, V>>);

    impl<K, V> Default for Map<K, V> {
        fn default() -> Self {
            Self(None)
        }
    }
}
pub use map::*;
''')
w('''
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

''')
w('// core/compileroptions.rs: the kind of a module, which ast/diagnostic.rs names.\n')
w(block('core/compileroptions.rs', 'pub struct ModuleKind(', 2))
w(line('core/compileroptions.rs', 'pub type ResolutionMode'))
w('''
// core/compileroptions.rs: the four fields and the method that the file reads.
pub struct CompilerOptions {
''')
for field in ['check_js', 'lib', 'no_property_access_from_index_signature', 'no_unchecked_indexed_access']:
    w(line('core/compileroptions.rs', '    pub %s:' % field))
w('''}

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use super::*;

    impl CompilerOptions {
''')
w(stub('core/compileroptions.rs', 'get_use_define_for_class_fields', 4))
w('    }\n\n')
for name in CORE_WHOLE:
    w(whole_fn('core/core.rs', name, 0))
w('}\npub use stand_ins::*;\n}\n\n')

w('pub mod collections {\n')
for rel in ['collections/ordered_map.rs', 'collections/ordered_set.rs', 'collections/set.rs']:
    w(path_mod(rel))
w('pub use ordered_map::*;\npub use ordered_set::*;\npub use set::*;\n}\n\n')

w('''pub mod jsnum {
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

// stringutil/util.rs: the comparison that ast/diagnostic.rs calls.
#[allow(unused_variables, clippy::needless_pass_by_value)]
pub mod stringutil {
    pub mod util {
        pub mod strings {
''')
w(stub('stringutil/util.rs', ('compare', '(a: &[u8], b: &[u8]) -> isize'), 4))
w('''        }
    }
}

#[allow(unused_variables, clippy::needless_pass_by_value)]
pub mod scanner {
    use crate::ast::{Ast, NodeId};

''')
w(stub('scanner/utilities.rs', 'declaration_name_to_string', 0))
w(stub('scanner/utilities.rs', 'get_text_of_node', 0))
w('''}

#[allow(unused_variables, clippy::needless_pass_by_value)]
pub mod binder {
    use crate::ast::{Ast, SymbolId};
    use crate::core::Text;

''')
w(stub('binder/binder.rs', 'get_symbol_name_for_private_identifier', 0))
w('''}

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

use crate::core::{List, TextRange, Tristate};

''')
w('// ast/symbol.rs\n')
w('pub type SymbolTable = SymbolTableId;\n')
w(block('ast/symbol.rs', 'pub struct Symbol<', 1))
w('// ast/utilities.rs\n')
w(block('ast/utilities.rs', 'pub struct FindAncestorResult(', 2))
w(block('ast/utilities.rs', 'impl FindAncestorResult {', 0))
w('// ast/ast_generated.rs\n')
for name in AST_RECORDS:
    w(block('ast/ast_generated.rs', 'pub struct %s {' % name, 1))
w('// ast/file.rs 562: the three fields of the view of a source file that the file reads.\n')
w('#[derive(Clone, Copy)]\npub struct SourceFile<\'a> {\n')
for field in ['is_declaration_file', 'common_js_module_indicator', 'external_module_indicator']:
    w(line('ast/file.rs', '    pub %s:' % field))
w('''    pub marker: std::marker::PhantomData<&'a ()>,
}

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
w(path_mod('checker/c01_data.rs'))
w(path_mod(FILE))
w('''pub use c01_data::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{
        Arg, Ast, DiagnosticId, DiagnosticStore, FlowNodeId, ModifierFlags, NodeId, SymbolFlags, SymbolId,
        SymbolTableId,
    };
    use crate::checker::c01_data::*;
    use crate::checker::types::checker_flags;
    use crate::checker::types::*;
    use crate::collections::Set;
    use crate::core::{CompilerOptions, Link, LinkStore, List, Map, ScriptTarget, Text, Tristate};
    use crate::diagnostics::MessageId;

    // checker.go:17471: the key of a cache, as checker/c30_type_keys.rs has its fields and derives.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
    pub struct CacheHashKey {
        pub hi: u64,
        pub lo: u64,
    }
    impl CacheHashKey {
        pub fn of(bytes: &[u8]) -> Self {
            loop {}
        }
    }

    // bun_core::StackCheck
    #[derive(Clone, Copy, Default)]
    pub struct StackCheck;
    impl StackCheck {
        pub fn is_safe_to_recurse(self) -> bool {
            true
        }
    }

    // checker/c02_program_checker.rs 122 and 226: the bounds of the lists and of the fallbacks.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for TypeId {}
    impl<'a> ListItem<'a> for SymbolId {}
    impl<'a> ListItem<'a> for NodeId {}
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

    // checker/c02_program_checker.rs 223
''')
w('    ' + line('checker/c02_program_checker.rs', 'pub type DeferredDiagnosticCallback<'))
w('\n    // checker/utilities.rs: AssignmentKind and the map of getFeatureMap.\n')
w(block('checker/utilities.rs', 'checker_flags!(AssignmentKind', 0))
w(block('checker/utilities.rs', 'pub struct FeatureMapEntry {', 1))
w(line('checker/utilities.rs', 'pub struct FeatureMap('))
w('impl FeatureMap {\n')
w(stub('checker/utilities.rs', ('get', 'FeatureMapEntry'), 4))
w('''}

    // checker/c02_program_checker.rs 379-731: the fields that c18 and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
        pub compiler_options: &'a CompilerOptions,
        pub stack_check: StackCheck,
        pub types: Records<TypeId, Type<'a>>,
        pub type_aliases: Records<TypeAliasId, TypeAlias<'a>>,
        pub nil_sections: NilSections<'a>,
        pub sink_sections: NilSections<'a>,
        pub diagnostic_store: DiagnosticStore,
''')
c02 = '\n'.join(lines_of('checker/c02_program_checker.rs'))
fields_block = re.search(r'checker_fields! \{(.*?)\n\}\n', c02, re.S).group(1)
ftypes = dict(re.findall(r'^\s+(\w+):\s*(.+?),\s*$', fields_block, re.M))
c18 = '\n'.join(l for l in lines_of(FILE) if not l.strip().startswith('//'))
named = sorted(set(re.findall(r'\bself\s*\.(\w+)\b(?!\()', c18)) | set(re.findall(r'\bc\.(\w+)\b(?!\()', c18)))
written = {'ast', 'compiler_options', 'stack_check', 'types', 'diagnostic_store'}
for field in named:
    if field in written:
        continue
    written.add(field)
    if field not in ftypes:
        sys.exit('c02_program_checker.rs has no field %s' % field)
    t = ftypes[field]
    t = re.sub(r'^NodeLinkStore<', 'LinkStore<NodeId, ', t)
    t = re.sub(r'^SymbolArenaLinkStore<', 'LinkStore<SymbolId, ', t)
    w('        pub %s: %s,\n' % (field, t))
w('''    }

    impl<'a> Checker<'a> {
''')
for rel, names in CHECKER_METHODS:
    for name in names:
        w(stub(rel, name, 4))
missing = 0
for name, text in MISSING.items():
    rel = MISSING_HOME[name]
    sig = None
    if os.path.exists(os.path.join(ROOT, rel)):
        sig, count = find_sig(rel, name, 4)
        if sig is None and count > 1:
            sys.exit('%s: %s: %d definitions' % (rel, name, count))
    if sig is not None:
        w(stub(rel, name, 4))
    else:
        if missing == 0:
            w('        // No file of the tree defines these yet.\n')
        missing += 1
        w(text)
w('    }\n\n')
for rel, names in CHECKER_FREE:
    for name in names:
        w(stub(rel, name, 0))
w('}\n}\n\n')

w('''// The consumers of the file: the calls that other files of checker/ make into its functions, with the arguments and the use of the result that the tree writes.
pub mod consumers {
    use crate::ast::{Kind, NodeId, SymbolId};
    use crate::checker::{CheckMode, Checker, TypeId};
    use crate::diagnostics::{self, MessageId};

    impl<'a> Checker<'a> {
        // c14_expressions.rs 680, 682, 713, 773, 873, 893, 1231, 1236, 1273 and 1322
        pub fn consumers_of_c14(&mut self, node: NodeId, container: NodeId, check_mode: CheckMode) -> TypeId {
            let a = self.ast;
            match a.kind(node) {
                Kind::Identifier => return self.check_identifier(node, check_mode),
                Kind::ThisKeyword => return self.check_this_expression(node),
                Kind::PropertyAccessExpression => {
                    return self.check_property_access_expression(node, check_mode, false);
                }
                _ => {}
            }
            let resolved_symbol =
                self.lookup_symbol_for_private_identifier_declaration(a.text(node), node);
            self.check_this_before_super(
                node,
                container,
                diagnostics::X_SUPER_MUST_BE_CALLED_BEFORE_ACCESSING_A_PROPERTY_OF_SUPER_IN_THE_CONSTRUCTOR_OF_A_DERIVED_CLASS,
            );
            if self.class_declaration_extends_null(container) {
                return self.null_widening_type;
            }
            let left = a.as_qualified_name(node).left;
            let this_type = self.check_this_expression(left);
            let left_type = self.check_non_null_type(this_type, left);
            let object_type = self.check_property_access_expression_or_qualified_name(
                node,
                left,
                left_type,
                a.as_qualified_name(node).right,
                check_mode,
                false,
            );
            if check_mode != CheckMode::NORMAL || self.is_method_access_for_call(node) {
                return object_type;
            }
            self.get_flow_type_of_access_expression(
                node,
                resolved_symbol,
                object_type,
                container,
                check_mode,
            )
        }

        // c28_types_of_symbols.rs 119, 471, 497 and 521, c31_binding_patterns_widening.rs 652, flow.rs 3868 and 3916
        pub fn consumers_of_types_of_symbols(&mut self, location: NodeId, func: NodeId, symbol: SymbolId) -> TypeId {
            let a = self.ast;
            let mut t = self.check_property_access_expression(location, CheckMode::NORMAL, true);
            if t.is_nil() {
                t = self.get_contextual_this_parameter_type(func);
            }
            if t.is_nil() {
                t = self.get_type_of_property_in_base_class(a.symbol(location));
            }
            if t.is_nil() {
                t = self.get_type_of_property_in_base_class(symbol);
            }
            let flow_type = self.get_flow_type_of_property(location, symbol);
            if flow_type == self.auto_type {
                return t;
            }
            flow_type
        }

        // c44_index_indexed_access.rs 601 and 1196, c20_object_literals_spread.rs 1030, c09_check_classes_interfaces.rs 411, c15_calls.rs 526, grammarchecks.rs 2753 and 2776
        pub fn consumers_of_predicates(&mut self, node: NodeId, declaration: NodeId, prop: SymbolId) -> bool {
            let a = self.ast;
            if self.is_deprecated_symbol(prop) && self.is_uncalled_function_reference(node, prop) {
                return true;
            }
            let ctor = self.get_control_flow_container(node);
            if ctor.is_nil()
                || self.get_control_flow_container(declaration) == self.get_control_flow_container(node)
            {
                return true;
            }
            if !self.is_node_within_class(node, declaration) {
                return false;
            }
            a.kind(node) == Kind::AwaitExpression
                && self.is_in_parameter_initializer_before_containing_function(node)
        }

        // c46_mark_references.rs 393, 397 and 406
        pub fn consumers_of_c46(&mut self, location: NodeId, right: NodeId, apparent_type: TypeId) -> SymbolId {
            let a = self.ast;
            let lexically_scoped_symbol =
                self.lookup_symbol_for_private_identifier_declaration(a.text(right), right);
            if check_mode_is_normal(CheckMode::NORMAL) || self.is_method_access_for_call(location) {
                return self.get_private_identifier_property_of_type(
                    apparent_type,
                    lexically_scoped_symbol,
                );
            }
            lexically_scoped_symbol
        }

        // c04_name_resolution_hooks.rs 98, 151 and 905, c52_symbol_at_location.rs 125, 427 and 478, c11_check_variables_decorators.rs 111, c06_check_members_type_nodes.rs 333
        pub fn consumers_of_c04_c52(&mut self, error_location: NodeId, parent: NodeId, parent_type: TypeId, property: SymbolId) -> bool {
            let a = self.ast;
            let container = self.get_this_container(error_location, false, false);
            if a.kind(a.parent(error_location)) == Kind::JSDocLink
                || self.check_and_report_error_for_extending_interface(error_location)
                || self.is_in_ambient_or_type_node(container)
            {
                return true;
            }
            self.check_property_access_expression(error_location, CheckMode::NORMAL, false);
            self.check_property_accessibility(
                error_location,
                !a.initializer(parent).is_nil() && a.kind(a.initializer(parent)) == Kind::SuperKeyword,
                false,
                parent_type,
                property,
            );
            self.class_declaration_extends_null(parent)
        }

        // The message of check_this_before_super is a value.
        pub fn consumers_of_messages(&mut self, node: NodeId, container: NodeId, message: MessageId) {
            self.check_this_before_super(node, container, message);
        }
    }

    fn check_mode_is_normal(check_mode: CheckMode) -> bool {
        check_mode == CheckMode::NORMAL
    }
}
''')

os.makedirs(WORK, exist_ok=True)
with open(os.path.join(WORK, 'c18-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('c18-probe.rs: %d lines, %d callees written by hand' % (''.join(out).count('\n'), missing))
