#!/usr/bin/env python3
# Writes c50-probe.rs beside this script: checker/c50_contextual_properties_inference_context.rs, checker/types.rs and
# checker/c01_data.rs of the tree by #[path], the leaf files they stand on by #[path], and stand-ins for every other name.
# The signature of a stand-in is read from the file of the tree that defines the function, at the time of the run; its
# body never returns. The callees that no file of the tree defines yet are written by hand in the block MISSING below,
# with upstream's parameter order. Map and LiveList of crate::core are the contract's
# (checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 153-270), until the tree has them.
# Run: python3 c50-probe-gen.py && rustc --edition 2024 --crate-type lib --emit=metadata -o /tmp/c50-probe.rmeta c50-probe.rs
# Clippy with the table of the workspace: sh c50-probe-clippy.sh
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
                             'type_parameters', 'body', 'children']),
    ('ast/reader.rs', [('kind', '(self, node: NodeId)'), ('parent', '(self, node: NodeId)'),
                       ('nodes', '(self, list: NodeListId)')]),
    ('ast/symbol.rs', ['sym', 'table_get']),
    ('ast/ast_generated.rs', ['as_conditional_expression', 'as_binary_expression']),
]
AST_FREE = [
    ('ast/utilities.rs', ['for_each_return_statement', 'get_node_id', 'has_context_sensitive_parameters',
                          'is_object_literal_method', 'node_kind_is']),
    ('ast/functionflags.rs', ['get_function_flags']),
    ('ast/ast_generated.rs', ['is_block', 'is_jsx_attribute', 'is_jsx_attributes', 'is_jsx_opening_element',
                              'is_object_literal_expression', 'is_property_assignment',
                              'is_shorthand_property_assignment']),
]
AST_RECORDS = ['ConditionalExpression', 'BinaryExpression']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'bad_cast', 'map_set', 'stack_limit', 'list_of', 'text', 'filter']),
    ('checker/links.rs', ['value_symbol_links_get']),
    ('checker/c14_expressions.rs', ['get_context_free_type_of_expression']),
    ('checker/c28_types_of_symbols.rs', ['get_type_of_symbol']),
    ('checker/c32_type_resolution.rs', ['find_resolution_cycle_start_index']),
    ('checker/c33_members_base_types_signatures.rs', ['get_property_of_type', 'get_properties_of_type',
                                                      'find_applicable_index_info',
                                                      'get_index_infos_of_structured_type']),
    ('checker/c36_properties_apparent_types.rs', ['get_reduced_type', 'get_apparent_type']),
    ('checker/c37_instantiation.rs', ['instantiate_type', 'get_constraint_type_from_mapped_type']),
    ('checker/c40_type_nodes_conditional_tuples.rs', ['is_generic_mapped_type',
                                                      'get_element_type_of_slice_of_tuple_type']),
    ('checker/c42_literal_types.rs', ['map_type_ex', 'get_string_literal_type']),
    ('checker/c43_unions_intersections.rs', ['get_intersection_type', 'get_union_type_ex', 'filter_type']),
    ('checker/c44_index_indexed_access.rs', ['get_mapped_type_name_type_kind']),
    ('checker/c45_base_constraints_normalization.rs', ['get_base_constraint_or_type', 'maybe_type_of_kind']),
    ('checker/c47_promised_mapped_template.rs', ['remove_missing_type']),
    ('checker/c51_type_facts_awaited.rs', ['get_actual_type_variable']),
    ('checker/jsx.rs', ['discriminate_contextual_type_by_jsx_attributes']),
    ('checker/relater.rs', ['is_type_assignable_to', 'is_discriminant_property', 'get_key_property_name',
                            'get_constituent_type_for_key_type', 'discriminate_type_by_discriminable_items']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', ['is_node_descendant_of', 'is_numeric_literal_name', 'for_each_yield_expression',
                              'value_to_string']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
    ('checker/c43_unions_intersections.rs', ['contains_type']),
    ('checker/inference.rs', ['has_inference_candidates_or_default']),
]
CORE_FREE = ['some', 'find', 'map']

# The callees of c50 that no file of the tree defines: upstream's name in snake_case, upstream's parameter order, an id for a pointer.
MISSING = {
    'get_contextual_type': '''
        pub fn get_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
''',
    'get_contextual_type_for_object_literal_method': '''
        pub fn get_contextual_type_for_object_literal_method(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
''',
    'substitute_indexed_mapped_type': '''
        pub fn substitute_indexed_mapped_type(&mut self, object_type: TypeId, index: TypeId) -> TypeId {
            loop {}
        }
''',
    'get_true_type_from_conditional_type': '''
        pub fn get_true_type_from_conditional_type(&mut self, t: TypeId) -> TypeId {
            loop {}
        }
''',
    'get_false_type_from_conditional_type': '''
        pub fn get_false_type_from_conditional_type(&mut self, t: TypeId) -> TypeId {
            loop {}
        }
''',
}
# Where a callee of MISSING lands by its upstream range: the stand-in of the tree replaces the one above once the file has it.
MISSING_HOME = {
    'get_contextual_type': 'checker/c48_contextual_types.rs',
    'get_contextual_type_for_object_literal_method': 'checker/c48_contextual_types.rs',
    'substitute_indexed_mapped_type': 'checker/c47_promised_mapped_template.rs',
    'get_true_type_from_conditional_type': 'checker/c40_type_nodes_conditional_tuples.rs',
    'get_false_type_from_conditional_type': 'checker/c40_type_nodes_conditional_tuples.rs',
}


def defined(rel, name):
    pat = re.compile(r'^    pub(?:\(crate\))? fn ' + re.escape(name) + r'[<(]')
    return any(pat.match(l) for l in lines_of(rel))


def path_mod(rel, name=None):
    name = name or os.path.basename(rel)[:-3]
    return '#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name)


out = []
w = out.append
w('''//! Probe of checker/c50_contextual_properties_inference_context.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by c50-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: diagnostics/, core/{arena,golang,linkstore,text,tristate,tristate_stringer_generated}.rs, collections/{set,ordered_map,ordered_set}.rs, jsnum/jsnum.rs, ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs, checker/{types,c01_data}.rs.
//! Run: rustc --edition 2024 --crate-type lib --emit=metadata -o /tmp/c50-probe.rmeta c50-probe.rs
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

impl<'a, T: Copy + Default> LiveList<'a, T> {
    pub const NIL: Self = Self(None);
    pub const fn from_cells(cells: &'a [std::cell::Cell<T>]) -> Self {
        Self(Some(cells))
    }
    pub const fn is_nil(self) -> bool {
        self.0.is_none()
    }
    fn cells(self) -> &'a [std::cell::Cell<T>] {
        self.0.unwrap_or(&[])
    }
    pub fn len(self) -> isize {
        self.cells().len() as isize
    }
    pub fn at(self, index: impl GoIndex) -> T {
        index
            .to_index()
            .and_then(|i| self.cells().get(i))
            .map(std::cell::Cell::get)
            .unwrap_or_default()
    }
    pub fn iter(self) -> impl Iterator<Item = T> + 'a {
        self.cells().iter().map(std::cell::Cell::get)
    }
}

// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 222-270: `map[K]V` that nothing ranges over. The contract writes it on bun_collections::HashMap, which is hashbrown's map: the map of std stands for it here, with the same variance.
#[allow(clippy::disallowed_types)]
mod map {
    use std::collections::HashMap;
    use std::hash::Hash;

    pub struct Map<K, V>(Option<HashMap<K, V>>);

    impl<K, V> Default for Map<K, V> {
        fn default() -> Self {
            Self(None)
        }
    }

    impl<K: Hash + Eq + Copy, V: Copy + Default> Map<K, V> {
        pub fn make() -> Self {
            Self(Some(HashMap::new()))
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
}
pub use map::*;

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

#[allow(unused_variables)]
mod stand_ins {
    use super::*;
''')
w(stub('jsnum/string.rs', 'from_string', 0))
w('''}
pub use stand_ins::*;
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
w('// ast/functionflags.rs\n')
w(block('ast/functionflags.rs', 'pub struct FunctionFlags(', 2))
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
w(path_mod('checker/c01_data.rs'))
w(path_mod('checker/c50_contextual_properties_inference_context.rs'))
w('''pub use c01_data::*;
pub use c50_contextual_properties_inference_context::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Ast, NodeId, SymbolId};
    use crate::checker::c01_data::*;
    use crate::checker::types::*;
    use crate::core::{Link, LinkStore, List, Map, Text};

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

    // checker/c02_program_checker.rs 379-731: the fields that c50 and types.rs read, with the types of the tree.
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

with open(os.path.join(HERE, 'c50-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('c50-probe.rs: %d lines, %d callees written by hand' % (''.join(out).count('\n'), missing))
