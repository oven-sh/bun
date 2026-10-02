#!/usr/bin/env python3
# Writes c52-probe.rs into a work directory: checker/c52_symbol_at_location.rs, checker/types.rs and checker/c01_data.rs
# of the tree by #[path], the leaf files they stand on by #[path], and stand-ins for every other name. The signature of
# a stand-in is read from the file of the tree that defines the function, at the time of the run; its body never
# returns. The callees that no file of the tree defines yet are written by hand in the block MISSING below, with
# upstream's parameter order: when the file of their upstream range has them, the signature of the tree replaces the
# hand-written one. Map and LiveList of crate::core are the contract's
# (checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 153-270), until the tree has them. The layout of
# this script is the one of c50-probe-gen.py.
# Run: sh c52-probe.sh
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/c52probe-run'
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


def line(rel, first):
    hits = [l for l in lines_of(rel) if l.startswith(first)]
    if len(hits) != 1:
        sys.exit('%s: %s: %d lines' % (rel, first, len(hits)))
    return hits[0] + '\n'


AST_METHODS = [
    ('ast/node_methods.rs', ['symbol', 'name', 'property_name', 'parameters', 'text', 'expression', 'arguments',
                             'body', 'initializer', 'for_each_child']),
    ('ast/reader.rs', [('kind', '(self, node: NodeId)'), ('parent', '(self, node: NodeId)'),
                       ('flags', '(self, node: NodeId)'), ('pos', '(self, node: NodeId)')]),
    ('ast/symbol.rs', ['sym', 'table_get', 'update_symbol']),
    ('ast/ast_generated.rs', ['as_meta_property', 'as_import_type_node', 'as_literal_type_node',
                              'as_element_access_expression', 'as_indexed_access_type_node',
                              'as_binary_expression']),
]
AST_FREE = [
    ('ast/utilities.rs', [
        'find_ancestor', 'find_ancestor_kind', 'get_external_module_import_equals_declaration_expression',
        'get_external_module_name', 'get_host_signature_from_jsdoc', 'get_node_at_position',
        'get_reparsed_node_for_node', 'get_source_file_of_node', 'is_bindable_object_define_property_call',
        'is_binding_pattern', 'is_class_or_interface_like', 'is_declaration', 'is_declaration_name',
        'is_declaration_name_or_import_property_name', 'is_entity_name', 'is_entity_name_expression',
        'is_expression_node', 'is_expression_with_type_arguments_in_class_extends_clause',
        'is_external_module_import_equals_declaration', 'is_external_or_common_js_module', 'is_function_like',
        'is_import_call', 'is_import_or_export_specifier', 'is_in_expression_context',
        'is_jsdoc_name_reference_context', 'is_jsx_tag_name', 'is_literal_computed_property_declaration_name',
        'is_literal_import_type_node', 'is_name_of_heritage_clause_type_reference', 'is_part_of_type_node',
        'is_right_side_of_qualified_name_or_property_access', 'is_this_in_type_query', 'is_type_declaration',
        'is_type_declaration_name', 'is_variable_declaration_initialized_to_require', 'node_is_missing',
        'try_get_class_implementing_or_extending_heritage_clause_element']),
    ('ast/ast_generated.rs', [
        'is_binary_expression', 'is_binding_element', 'is_call_expression', 'is_computed_property_name',
        'is_element_access_expression', 'is_export_assignment', 'is_identifier', 'is_import_attributes',
        'is_indexed_access_type_node', 'is_jsdoc_parameter_tag', 'is_literal_type_node', 'is_meta_property',
        'is_object_binding_pattern', 'is_private_identifier', 'is_property_access_expression',
        'is_qualified_name', 'is_source_file']),
]
AST_RECORDS = ['MetaProperty', 'ImportTypeNode', 'LiteralTypeNode', 'ElementAccessExpression',
               'IndexedAccessTypeNode', 'BinaryExpression']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'bad_cast', 'map_set', 'stack_limit', 'list_of', 'filter']),
    ('checker/links.rs', ['value_symbol_links_get']),
    ('checker/c03_init.rs', ['get_global_import_attributes_type']),
    ('checker/c04_name_resolution_hooks.rs', ['get_symbol']),
    ('checker/c05_check_source_file.rs', ['resolve_jsdoc_member_name']),
    ('checker/c14_expressions.rs', ['check_expression', 'check_expression_cached', 'get_type_of_expression',
                                    'check_qualified_name', 'get_symbol_for_private_identifier_expression']),
    ('checker/c21_resolved_symbols_diagnostics.rs', ['get_resolved_symbol', 'get_resolved_symbol_or_nil']),
    ('checker/c22_symbols_merge.rs', ['new_symbol', 'get_merged_symbol', 'get_symbol_of_declaration',
                                      'get_symbol_of_node']),
    ('checker/c23_alias_targets.rs', ['get_symbol_of_part_of_right_hand_side_of_import_equals']),
    ('checker/c24_external_modules.rs', ['resolve_external_module_name']),
    ('checker/c25_entity_names.rs', ['resolve_entity_name']),
    ('checker/c26_exports_late_binding.rs', ['get_exports_of_symbol']),
    ('checker/c27_resolve_alias.rs', ['resolve_alias']),
    ('checker/c28_types_of_symbols.rs', ['get_type_of_symbol', 'get_type_for_variable_like_declaration']),
    ('checker/c29_constraints.rs', ['get_declared_type_of_class_or_interface']),
    ('checker/c33_members_base_types_signatures.rs', [
        'get_property_of_type', 'get_index_infos_of_type', 'is_applicable_index_type',
        'get_applicable_index_info', 'get_base_types', 'get_type_with_this_argument',
        'get_signature_from_declaration']),
    ('checker/c36_properties_apparent_types.rs', ['get_type_arguments']),
    ('checker/c38_type_nodes_references.rs', ['get_type_from_type_node', 'get_type_from_this_type_node',
                                              'get_unresolved_symbol_for_entity_name',
                                              'get_declared_type_of_symbol']),
    ('checker/c42_literal_types.rs', ['map_type', 'get_regular_type_of_literal_type']),
    ('checker/c43_unions_intersections.rs', ['is_error_type']),
    ('checker/c44_index_indexed_access.rs', ['get_literal_type_from_property_name']),
    ('checker/c50_contextual_properties_inference_context.rs', ['get_apparent_type_of_contextual_type']),
    ('checker/flow.rs', ['get_symbol_has_instance_method_of_object_type']),
    ('checker/jsx.rs', ['get_intrinsic_tag_symbol']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', [
        'get_containing_object_literal', 'is_import_type_qualifier_part',
        'is_in_name_of_expression_with_type_arguments_or_heritage_type_reference',
        'is_in_right_side_of_import_or_export_assignment', 'is_jsx_intrinsic_tag_name', 'is_type_any',
        'is_type_reference_identifier', 'node_starts_new_lexical_environment', 'value_to_string']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
]
CORE_FREE = ['append_if_unique', 'first_or_nil']

# The callees of c52 that no file of the tree defined when this was written: upstream's name in snake_case, upstream's parameter order, an id for a pointer.
MISSING = {
    'get_immediate_aliased_symbol': '''
        pub fn get_immediate_aliased_symbol(&mut self, symbol: SymbolId) -> SymbolId {
            loop {}
        }
''',
    'check_new_target_meta_property': '''
        pub fn check_new_target_meta_property(&mut self, node: NodeId) -> TypeId {
            loop {}
        }
''',
    'check_meta_property_keyword': '''
        pub fn check_meta_property_keyword(&mut self, node: NodeId) -> TypeId {
            loop {}
        }
''',
    'get_global_import_meta_expression_type': '''
        pub fn get_global_import_meta_expression_type(&mut self) -> TypeId {
            loop {}
        }
''',
    'get_this_container': '''
        pub fn get_this_container(&mut self, node: NodeId, include_arrow_functions: bool, include_class_computed_property_name: bool) -> NodeId {
            loop {}
        }
''',
    'check_property_access_expression': '''
        pub fn check_property_access_expression(&mut self, node: NodeId, check_mode: CheckMode, write_only: bool) -> TypeId {
            loop {}
        }
''',
}
# Where a callee of MISSING lands by its upstream range.
MISSING_HOME = {
    'get_immediate_aliased_symbol': 'checker/c04_name_resolution_hooks.rs',
    'check_new_target_meta_property': 'checker/c17_unary_meta_yield.rs',
    'check_meta_property_keyword': 'checker/c17_unary_meta_yield.rs',
    'get_global_import_meta_expression_type': 'checker/c40_type_nodes_conditional_tuples.rs',
    'get_this_container': 'checker/c18_identifiers_property_access_this.rs',
    'check_property_access_expression': 'checker/c18_identifiers_property_access_this.rs',
}


def path_mod(rel, name=None):
    name = name or os.path.basename(rel)[:-3]
    return '#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name)


out = []
w = out.append
w('''//! Probe of checker/c52_symbol_at_location.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by c52-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: diagnostics/, core/{arena,golang,linkstore,text,tristate,tristate_stringer_generated}.rs, collections/{set,ordered_map,ordered_set}.rs, jsnum/jsnum.rs, ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs, checker/{types,c01_data}.rs.
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
''')
if 'pub struct Map' not in golang:
    w('''
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
w(line('ast/symbol.rs', 'pub const INTERNAL_SYMBOL_NAME_INDEX:'))
w('// ast/ast_generated.rs\n')
for name in AST_RECORDS:
    w(block('ast/ast_generated.rs', 'pub struct %s {' % name, 1))
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
w(path_mod('checker/c52_symbol_at_location.rs'))
w('''pub use c01_data::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Ast, NodeId, SymbolFlags, SymbolId, SymbolTableId};
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

''')
emit = os.path.join(ROOT, 'checker/emitresolver.rs')
if os.path.exists(emit):
    w('    // checker/emitresolver.rs\n    ' + line('checker/emitresolver.rs', 'pub struct EmitResolver'))
else:
    w('    // checker/emitresolver.rs has no file yet: the value that symbolaccessibility.rs and nodebuilderimpl.rs name.\n    pub struct EmitResolver;\n')
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

    // checker/c02_program_checker.rs 379-731: the fields that c52 and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
        pub stack_check: StackCheck,
        pub types: Records<TypeId, Type<'a>>,
        pub type_aliases: Records<TypeAliasId, TypeAlias<'a>>,
        pub nil_sections: NilSections<'a>,
        pub sink_sections: NilSections<'a>,
''')
c02 = '\n'.join(lines_of('checker/c02_program_checker.rs'))
fields_block = re.search(r'checker_fields! \{(.*?)\n\}\n', c02, re.S).group(1)
ftypes = dict(re.findall(r'^\s+(\w+):\s*(.+?),\s*$', fields_block, re.M))
for field in ['signatures', 'index_infos', 'symbol_node_links', 'value_symbol_links',
              'cached_arguments_referenced', 'error_type', 'unknown_symbol', 'arguments_symbol',
              'any_base_type_index_info', 'global_this_type']:
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
w('}\n}\n')

os.makedirs(WORK, exist_ok=True)
with open(os.path.join(WORK, 'c52-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('c52-probe.rs: %d lines, %d callees written by hand' % (''.join(out).count('\n'), missing))
