#!/usr/bin/env python3
# Writes c19-probe.rs into the directory given as the first argument (default /tmp/c19-probe):
# checker/c19_assertions_binary_operators.rs, checker/types.rs and checker/c01_data.rs of the tree by #[path], the leaf
# packages (diagnostics, core, collections, jsnum, stringutil, tspath) and eight files of ast/ by #[path], and stand-ins
# for every other name. The signature of a stand-in is read from the file of the tree that defines the function, at the
# time of the run; its body never returns. The callees that no file of the tree defines yet are written by hand in the
# block MISSING below, with upstream's parameter order. bun_collections is a one-line crate that names the map of std.
# Run: sh c19-probe.sh (rustc alone) and sh c19-probe-clippy.sh (clippy-driver with the table of the workspace).
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
HERE = sys.argv[1] if len(sys.argv) > 1 else '/tmp/c19-probe'
os.makedirs(HERE, exist_ok=True)
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
    ('ast/node_methods.rs', ['symbol', 'name', 'properties', 'property_list', 'elements', 'element_list',
                             'initializer', 'type_node', 'expression', 'text']),
    ('ast/reader.rs', [('kind', '(self, node: NodeId)'), ('parent', '(self, node: NodeId)'),
                       ('nodes', '(self, list: NodeListId)'), ('pos', '(self, node: NodeId)'),
                       ('flags', '(self, node: NodeId)')]),
    ('ast/symbol.rs', ['sym']),
    ('ast/ast_generated.rs', ['as_conditional_expression', 'as_binary_expression', 'as_if_statement',
                              'as_prefix_unary_expression', 'as_shorthand_property_assignment']),
]
AST_FREE = [
    ('ast/utilities.rs', ['get_assignment_declaration_kind', 'get_containing_class', 'get_source_file_of_node',
                          'is_access_expression', 'is_compound_assignment', 'is_entity_name_expression',
                          'is_in_js_file', 'is_logical_binary_operator',
                          'is_logical_or_coalescing_binary_expression', 'is_logical_or_coalescing_binary_operator',
                          'skip_outer_expressions', 'skip_parentheses', 'walk_up_parenthesized_expressions']),
    ('ast/ast.rs', ['is_declaration_node']),
    ('ast/ast_generated.rs', ['is_array_literal_expression', 'is_binary_expression', 'is_call_expression',
                              'is_enum_member', 'is_identifier', 'is_if_statement', 'is_numeric_literal',
                              'is_object_literal_expression', 'is_omitted_expression',
                              'is_parenthesized_expression', 'is_private_identifier',
                              'is_property_access_expression', 'is_property_assignment',
                              'is_shorthand_property_assignment', 'is_spread_assignment', 'is_spread_element',
                              'is_tagged_template_expression']),
]
AST_RECORDS = ['ConditionalExpression', 'BinaryExpression', 'IfStatement', 'PrefixUnaryExpression',
               'ShorthandPropertyAssignment']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'fail_detail', 'bad_cast', 'map_set', 'stack_limit', 'list_of', 'text', 'filter']),
    ('checker/c03_init.rs', ['evaluate', 'get_global_nan_symbol_or_nil']),
    ('checker/c05_check_source_file.rs', ['check_source_element', 'check_node_deferred',
                                          'should_check_erasable_syntax']),
    ('checker/c08_check_statements.rs', ['check_testing_known_truthy_callable_or_awaitable_or_enum_member_type']),
    ('checker/c12_iteration_types.rs', ['check_iterated_type_or_element_type']),
    ('checker/c14_expressions.rs', ['check_expression', 'check_expression_ex', 'check_non_null_type',
                                    'get_type_of_expression']),
    ('checker/c15_calls.rs', ['get_resolved_signature']),
    ('checker/c20_object_literals_spread.rs', ['has_default_value', 'is_valid_const_assertion_argument']),
    ('checker/c21_resolved_symbols_diagnostics.rs', ['add_diagnostic', 'error', 'error_or_suggestion',
                                                     'error_and_maybe_suggest_await', 'get_resolved_symbol']),
    ('checker/c22_symbols_merge.rs', ['create_diagnostic_for_node']),
    ('checker/c31_binding_patterns_widening.rs', ['get_widened_type', 'get_flow_type_of_destructuring',
                                                  'get_rest_type', 'get_non_nullable_type']),
    ('checker/c33_members_base_types_signatures.rs', ['get_property_of_type', 'get_type_of_property_of_type']),
    ('checker/c34_return_types.rs', ['get_return_type_of_signature']),
    ('checker/c38_type_nodes_references.rs', ['get_type_from_type_node', 'is_array_like_type']),
    ('checker/c40_type_nodes_conditional_tuples.rs', ['create_array_type']),
    ('checker/c42_literal_types.rs', ['get_regular_type_of_literal_type', 'get_base_type_of_literal_type',
                                      'get_base_type_of_literal_type_for_comparison', 'get_number_literal_type',
                                      'map_type']),
    ('checker/c43_unions_intersections.rs', ['is_error_type', 'get_union_type', 'get_union_type_ex',
                                             'is_empty_anonymous_object_type']),
    ('checker/c44_index_indexed_access.rs', ['get_literal_type_from_property_name', 'get_indexed_access_type_ex',
                                             'get_indexed_access_type_or_undefined']),
    ('checker/c45_base_constraints_normalization.rs', ['get_regular_type_of_object_literal',
                                                       'is_type_assignable_to_kind',
                                                       'is_type_assignable_to_kind_ex', 'maybe_type_of_kind',
                                                       'maybe_type_of_kind_considering_base_constraint',
                                                       'all_types_assignable_to_kind',
                                                       'get_base_constraint_or_type']),
    ('checker/c46_mark_references.rs', ['check_external_emit_helpers']),
    ('checker/c47_promised_mapped_template.rs', ['extract_definitely_falsy_types',
                                                 'remove_definitely_falsy_types']),
    ('checker/c49_call_arguments_decorator_signatures.rs', ['create_synthetic_expression']),
    ('checker/c51_type_facts_awaited.rs', ['has_type_facts', 'get_type_with_facts', 'get_awaited_type_no_alias',
                                           'get_awaited_type_of_promise']),
    ('checker/grammarchecks.rs', ['grammar_error_on_node', 'check_grammar_for_disallowed_trailing_comma']),
    ('checker/printer.rs', ['type_to_string_exported']),
    ('checker/relater.rs', ['is_type_comparable_to', 'check_type_comparable_to', 'is_type_assignable_to',
                            'are_types_comparable', 'slice_tuple_type',
                            'check_type_assignable_to_and_optionally_elaborate',
                            'get_type_names_for_error_display', 'check_type_assignable_to',
                            'is_exact_optional_property_mismatch']),
    ('checker/utilities.rs', ['is_unchecked_js_suggestion']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', ['entity_name_to_string', 'get_property_name_from_type', 'is_const_type_reference',
                              'is_literal_expression_of_object', 'is_type_any',
                              'is_type_usable_as_property_name', 'value_to_string']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
    ('checker/c43_unions_intersections.rs', ['every_type', 'some_type']),
]
CORE_FREE = ['some', 'if_else', 'or_else']

# The callees of c19 that no file of the tree defines: upstream's name in snake_case, upstream's parameter order.
MISSING = {
    'mark_property_as_referenced': '''
        pub fn mark_property_as_referenced(&mut self, prop: SymbolId, node_for_check_write_only: NodeId, is_self_type_access: bool) {
            loop {}
        }
''',
    'check_property_accessibility': '''
        pub fn check_property_accessibility(&mut self, node: NodeId, is_super: bool, writing: bool, t: TypeId, prop: SymbolId) -> bool {
            loop {}
        }
''',
    'check_property_access_expression': '''
        pub fn check_property_access_expression(&mut self, node: NodeId, check_mode: CheckMode, write_only: bool) -> TypeId {
            loop {}
        }
''',
    'report_nonexistent_property': '''
        pub fn report_nonexistent_property(&mut self, prop_node: NodeId, containing_type: TypeId, is_unchecked_js: bool) {
            loop {}
        }
''',
}
MISSING_HOME = {
    'mark_property_as_referenced': 'checker/c45_base_constraints_normalization.rs',
    'check_property_accessibility': 'checker/c18_identifiers_property_access_this.rs',
    'check_property_access_expression': 'checker/c18_identifiers_property_access_this.rs',
    'report_nonexistent_property': 'checker/c18_identifiers_property_access_this.rs',
}


def defined(rel, name):
    if not os.path.exists(os.path.join(ROOT, rel)):
        return False
    pat = re.compile(r'^    pub(?:\(crate\))? fn ' + re.escape(name) + r'[<(]')
    return any(pat.match(l) for l in lines_of(rel))


def path_mod(rel, name=None):
    name = name or os.path.basename(rel)[:-3]
    return '#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name)


out = []
w = out.append
w('''//! Probe of checker/c19_assertions_binary_operators.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by c19-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: the packages diagnostics, core, collections, jsnum, stringutil and tspath, ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs, checker/{types,c01_data}.rs.
//! Run: sh c19-probe.sh
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unreachable_pub, unused_assignments)]

''')
w(path_mod('diagnostics/mod.rs', 'diagnostics'))
for pkg in ['core', 'collections', 'jsnum', 'stringutil', 'tspath']:
    w(path_mod(pkg + '/mod.rs', pkg))
w('''
pub mod evaluator {
    use crate::checker::LiteralValue;
''')
w(block('evaluator/evaluator.rs', 'pub struct Result<', 2))
w('''}

pub mod scanner {
    use crate::ast::{Ast, Kind, NodeId};
    #[allow(unused_variables)]
    mod stand_ins {
        use super::*;
''')
w(stub('scanner/scanner.rs', 'skip_trivia', 0))
w(stub('scanner/scanner.rs', 'token_to_string', 0))
w(stub('scanner/utilities.rs', 'get_text_of_node', 0))
w('''    }
    pub use stand_ins::*;
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
w('// ast/functionflags.rs\n')
w(block('ast/functionflags.rs', 'pub struct FunctionFlags(', 2))
w('''
// ast/utilities.rs
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct OuterExpressionKinds(pub i32);
impl OuterExpressionKinds {
    pub const PARENTHESES: Self = Self(1 << 0);
    pub const ASSERTIONS: Self = Self(1 << 1);
    pub const ALL: Self = Self(1 << 2);
}
impl std::ops::BitOr for OuterExpressionKinds {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct JSDeclarationKind(pub i32);
impl JSDeclarationKind {
    pub const EXPORTS_PROPERTY: Self = Self(2);
}

// ast/file.rs: the view of a source file, as far as the checker file reads it.
#[derive(Clone, Copy)]
pub struct SourceFile<'a> {
    pub marker: std::marker::PhantomData<&'a ()>,
}
impl<'a> SourceFile<'a> {
    pub fn text(self) -> &'a [u8] {
        loop {}
    }
    pub fn file_name(self) -> &'a [u8] {
        loop {}
    }
    pub fn diagnostics(self) -> &'a [DiagnosticId] {
        loop {}
    }
    pub fn diagnostic_store(self) -> Option<&'a DiagnosticStore> {
        loop {}
    }
}

// Invariant in its lifetime, as the context of the tree is: it names stores with interior mutability.
#[derive(Clone, Copy)]
pub struct Ast<'a> {
    pub marker: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
}

impl<'a> Ast<'a> {
    // ast/reader.rs
    pub fn as_source_file(self, node: NodeId) -> SourceFile<'a> {
        let _ = node;
        loop {}
    }
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
w(path_mod('checker/c19_assertions_binary_operators.rs'))
w('''pub use c01_data::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Arg, Ast, DiagnosticId, DiagnosticStore, Kind, NodeId, NodeListId, SymbolId};
    use crate::checker::c01_data::*;
    use crate::checker::types::*;
    use crate::core::{CompilerOptions, Link, LinkStore, List, Map, ScriptTarget, Text, Tristate};
    use crate::diagnostics::MessageId;
    use crate::evaluator;
    use crate::jsnum::Number;

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

    // checker/relater.rs
''')
w('    ' + block('checker/relater.rs', 'pub trait Discriminator<', 0).replace('\n', '\n    ').rstrip(' ') + '\n')
w('''
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

    // checker/c02_program_checker.rs 379-731: the fields that c19 and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
        pub stack_check: StackCheck,
        pub types: Records<TypeId, Type<'a>>,
        pub type_aliases: Records<TypeAliasId, TypeAlias<'a>>,
        pub inference_contexts: Records<InferenceContextId, InferenceContext<'a>>,
        pub inference_infos: Records<InferenceInfoId, InferenceInfo>,
        pub nil_sections: NilSections<'a>,
        pub sink_sections: NilSections<'a>,
        pub string_literal_types: Map<Text<'a>, TypeId>,
        pub discriminated_contextual_types: Map<DiscriminatedContextualTypeKey, TypeId>,
        pub signatures: Records<SignatureId, Signature<'a>>,
        pub index_infos: Records<IndexInfoId, IndexInfo<'a>>,
        pub value_symbol_links: LinkStore<SymbolId, ValueSymbolLinks>,
        pub error_type: TypeId,
        pub unknown_type: TypeId,
        pub undefined_type: TypeId,
        pub regular_false_type: TypeId,
        pub regular_true_type: TypeId,
        pub true_type: TypeId,
        pub contextual_infos: Vec<ContextualInfo>,
        pub inference_context_infos: Vec<InferenceContextInfo>,
        pub compiler_options: &'a CompilerOptions,
        pub language_version: ScriptTarget,
        pub strict_null_checks: bool,
        pub exact_optional_property_types: bool,
        pub diagnostic_store: DiagnosticStore,
        pub assertion_links: LinkStore<NodeId, AssertionLinks>,
        pub symbol_node_links: LinkStore<NodeId, SymbolNodeLinks>,
        pub silent_never_type: TypeId,
        pub number_type: TypeId,
        pub bigint_type: TypeId,
        pub string_type: TypeId,
        pub any_type: TypeId,
        pub boolean_type: TypeId,
        pub number_or_big_int_type: TypeId,
        pub string_number_symbol_type: TypeId,
        pub non_primitive_type: TypeId,
        pub unknown_empty_object_type: TypeId,
        pub undefined_symbol: SymbolId,
        pub resolving_signature: SignatureId,
        pub unknown_signature: SignatureId,
    }

    impl<'a> Checker<'a> {
''')
for rel, names in CHECKER_METHODS:
    for name in names:
        w(stub(rel, name, 4))
missing = 0
for name, text in MISSING.items():
    rel = MISSING_HOME[name]
    if defined(rel, name):
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
w('}\n}\n')

with open(os.path.join(HERE, 'c19-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('c19-probe.rs: %d lines, %d callees written by hand' % (''.join(out).count('\n'), missing))
with open(os.path.join(HERE, 'bun_collections.rs'), 'w') as f:
    f.write('pub use std::collections::HashMap;\n')
