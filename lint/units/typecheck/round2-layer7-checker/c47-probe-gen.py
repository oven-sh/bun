#!/usr/bin/env python3
# Writes a probe of checker/c47_promised_mapped_template.rs into a work directory (argument 1, default /tmp/c47probe-run):
#   lib.rs       the file of the tree and checker/types.rs by #[path], the leaf files they stand on by #[path], and a
#                stand-in for every other name: its signature is read from the file of the tree that defines it, at the
#                time of the run, and its body never returns. The flag sets, keys and records of c01_data.rs that the
#                file names are copied from the tree, as are the fields of the Checker with their types.
# Two stand-ins are assumptions, because the tree does not have them at the time of writing: Map of crate::core (as the
# contract has it) and get_modifiers_type_from_mapped_type (checker.go 28250, written as its five callers call it).
# The helpers are those of c30-probe-gen.py. Run: sh c47-probe.sh
import os
import re
import sys

REPO = '/workspace/wt/typecheck'
ROOT = REPO + '/src/typecheck'
W = sys.argv[1] if len(sys.argv) > 1 else '/tmp/c47probe-run'
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


def path_mod(rel, name=None):
    name = name or os.path.basename(rel)[:-3]
    return '#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name)


FILE = 'checker/c47_promised_mapped_template.rs'
AST_METHODS = [
    ('ast/reader.rs', [('kind', '(self, node: NodeId)')]),
    ('ast/symbol.rs', ['sym']),
    ('ast/ast_generated.rs', ['as_mapped_type_node', 'as_type_parameter_declaration']),
]
AST_FREE = [
    ('ast/ast_generated.rs', ['is_type_parameter_declaration']),
    ('ast/utilities.rs', ['is_optional_chain', 'is_outermost_optional_chain', 'is_expression_of_optional_chain_root']),
]
AST_RECORDS = ['TypeParameterDeclaration', 'MappedTypeNode']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'bad_cast', 'assert', 'map_set', 'slice_set', 'stack_limit', 'list_of', 'text', 'map_list']),
    ('checker/c03_init.rs', ['get_global_promise_type']),
    ('checker/c12_iteration_types.rs', ['is_reference_to_type']),
    ('checker/c21_resolved_symbols_diagnostics.rs', ['error']),
    ('checker/c31_binding_patterns_widening.rs', ['add_optionality_ex', 'get_optional_type', 'get_non_nullable_type']),
    ('checker/c33_members_base_types_signatures.rs', ['get_properties_of_type', 'get_type_of_property_of_type', 'get_signatures_of_type', 'get_applicable_index_info_for_name']),
    ('checker/c34_return_types.rs', ['add_optional_type_marker']),
    ('checker/c36_properties_apparent_types.rs', ['get_type_arguments']),
    ('checker/c37_instantiation.rs', ['instantiate_type', 'get_type_parameter_from_mapped_type', 'get_template_type_from_mapped_type']),
    ('checker/c40_type_nodes_conditional_tuples.rs', ['is_generic_type', 'is_generic_index_type']),
    ('checker/c41_new_types.rs', ['new_template_literal_type', 'new_string_mapping_type']),
    ('checker/c42_literal_types.rs', ['get_string_literal_type', 'map_type']),
    ('checker/c43_unions_intersections.rs', ['get_union_type', 'get_union_type_ex', 'is_pattern_literal_placeholder_type', 'is_pattern_literal_type', 'filter_type', 'remove_type', 'check_cross_product_union']),
    ('checker/c44_index_indexed_access.rs', ['get_literal_type_from_property']),
    ('checker/c45_base_constraints_normalization.rs', ['get_base_constraint_or_type', 'get_base_constraint_of_type', 'all_types_assignable_to_kind']),
    ('checker/c51_type_facts_awaited.rs', ['has_type_facts', 'get_type_with_facts']),
    ('checker/mapper.rs', ['combine_type_mappers']),
    ('checker/printer.rs', ['type_to_string_exported']),
    ('checker/relater.rs', ['is_type_assignable_to', 'is_type_related_to', 'get_type_at_position', 'get_this_type_of_signature']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', ['value_to_string', 'is_type_any']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
    ('checker/c30_type_keys.rs', ['get_template_type_key']),
    ('checker/c42_literal_types.rs', ['get_string_literal_value', 'get_number_literal_value']),
    ('checker/c51_type_facts_awaited.rs', ['is_zero_big_int']),
    ('checker/mapper.rs', ['new_simple_type_mapper']),
]
C01_FLAGS = ['IntersectionState', 'CachedTypeKind', 'IntrinsicTypeKind', 'MappedTypeModifiers', 'TypeFacts', 'UnionReduction']
C01_RECORDS = ['pub struct CachedTypeKey', 'pub struct StringMappingKey', 'pub enum RelationKind']
STRINGUTIL = [
    ('stringutil/js_case.rs', ['to_lower_js', 'to_upper_js']),
    ('stringutil/util.rs', ['decode_js_string_rune', 'combine_surrogate_pairs']),
]

# The callers of the functions that the file brings, as they are written in the tree at the time of the run: each is compiled in the probe against the real definitions.
CALLERS = r'''
// What the other files of checker/ write at their call sites of the functions of the file.
pub mod callers {
    use crate::ast::{NodeId, SymbolId};
    use crate::checker::{
        Checker, MappedTypeModifiers, TypeId, apply_string_mapping, get_mapped_type_modifiers,
        is_partial_mapped_type,
    };
    use crate::core::Text;

    impl<'a> Checker<'a> {
        // c37_instantiation.rs 342, relater.rs 4372, c45_base_constraints_normalization.rs 189, c38_type_nodes_references.rs 1248
        pub fn caller_get_string_mapping_type(&mut self, symbol: SymbolId, t: TypeId) -> TypeId {
            self.get_string_mapping_type(symbol, t)
        }

        // relater.rs 7004-7011
        pub fn caller_relater(c: &mut Checker<'_>, source: TypeId, target: TypeId) -> bool {
            let modifiers_related = get_mapped_type_modifiers(c, source)
                == get_mapped_type_modifiers(c, target)
                || c.get_combined_mapped_type_optionality(source)
                    <= c.get_combined_mapped_type_optionality(target);
            modifiers_related
                && c.get_combined_mapped_type_optionality(source) < 0
                && is_partial_mapped_type(c, target)
                && !get_mapped_type_modifiers(c, source)
                    .intersects(MappedTypeModifiers::INCLUDE_OPTIONAL)
        }

        // c37_instantiation.rs 875
        pub fn caller_modifiers(&mut self, mapped_type: TypeId) -> MappedTypeModifiers {
            get_mapped_type_modifiers(self, mapped_type)
        }

        // relater.rs 2254, flow.rs 1265, jsx.rs 2126
        pub fn caller_property_or_index(&mut self, t: TypeId, name: Text<'a>, other: &[u8]) -> bool {
            let target_type = self.get_type_of_property_or_index_signature_of_type(t, name);
            !target_type.is_nil()
                && !self
                    .get_type_of_property_or_index_signature_of_type(t, other)
                    .is_nil()
        }

        // c45_base_constraints_normalization.rs 198, c29_constraints.rs 278
        pub fn caller_substitute(&mut self, object_type: TypeId, index_type: TypeId) -> TypeId {
            self.substitute_indexed_mapped_type(object_type, index_type)
        }

        // flow.rs 3252, c15_calls.rs 292, c14_expressions.rs 141 and 1258
        pub fn caller_optional_expression(&mut self, func_type: TypeId, expression: NodeId) -> TypeId {
            self.get_optional_expression_type(func_type, expression)
        }

        // c20_object_literals_spread.rs 610
        pub fn caller_falsy(&mut self, mapped: TypeId) -> TypeId {
            self.remove_definitely_falsy_types(mapped)
        }

        // inference.rs 916-922
        pub fn caller_inference(c: &mut Checker<'a>, right: TypeId, str: Text<'a>) -> bool {
            *str == *apply_string_mapping(c.ast, c.types[right].symbol, str)
        }
    }
}
'''

src = '\n'.join(lines_of(FILE))
c02 = '\n'.join(lines_of('checker/c02_program_checker.rs'))
fields_block = re.search(r'checker_fields! \{(.*?)\n\}\n', c02, re.S).group(1)
ftypes = dict(re.findall(r'^\s+(\w+):\s*(.+?),\s*$', fields_block, re.M))
code = re.sub(r'//.*', '', src)
named = set(re.findall(r'\b(?:c|self)\.(\w+)\b(?!\()', code))
# The fields that types.rs reads, and the ones of the stand-ins below.
named |= {'ast', 'stack_check', 'types', 'type_aliases', 'nil_sections', 'sink_sections', 'error_type'}
unknown = sorted(f for f in named if f not in ftypes)
if unknown:
    sys.exit('%s names fields that c02_program_checker.rs does not have: %s' % (FILE, unknown))
fields = []
for f in sorted(named):
    t = ftypes[f].strip()
    if '=' in t:
        t = t.split('=')[0].strip()
    fields.append('        pub %s: %s,' % (f, t))

os.makedirs(W, exist_ok=True)
out = []
w = out.append
w('''//! Probe of checker/c47_promised_mapped_template.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by c47-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: core/{golang,tristate,tristate_stringer_generated}.rs, collections/{set,ordered_map,ordered_set}.rs, ast/{flags,ids,checkflags,symbolflags,kind_generated}.rs, diagnostics/, checker/types.rs, checker/c47_promised_mapped_template.rs.
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unreachable_pub, unused_assignments)]

''')
w('pub mod core {\n')
for rel in ['core/golang.rs', 'core/tristate.rs', 'core/tristate_stringer_generated.rs']:
    w(path_mod(rel))
w('''pub use golang::*;
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
    pub fn get(&self, key: &K) -> V {
        self.0.as_ref().and_then(|m| m.get(key)).copied().unwrap_or_default()
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

// core/core.rs, with their bodies
''')
w(block('core/core.rs', 'pub fn if_else<', 0))
w(block('core/core.rs', 'pub fn or_else<', 0))
w('}\n\n')

w('pub mod collections {\n')
for rel in ['collections/ordered_map.rs', 'collections/ordered_set.rs', 'collections/set.rs']:
    w(path_mod(rel))
w('pub use ordered_map::*;\npub use ordered_set::*;\npub use set::*;\n}\n\n')

w('#[path = "%s/diagnostics/mod.rs"]\npub mod diagnostics;\n\n' % ROOT)

w('''pub mod jsnum {
    // jsnum/jsnum.rs 7 and jsnum/pseudobigint.rs 6
    #[derive(Clone, Copy, PartialEq, PartialOrd, Default, Debug)]
    pub struct Number(pub f64);
    #[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
    pub struct PseudoBigInt {
        pub negative: bool,
        pub base10_value: Vec<u8>,
    }
}

#[allow(unused_variables)]
pub mod evaluator {
    use crate::checker::LiteralValue;

    #[derive(Default)]
    pub struct Result<'a> {
        pub marker: std::marker::PhantomData<&'a ()>,
    }

''')
w(stub('evaluator/evaluator.rs', 'any_to_string', 0))
w('}\n\n')

w('#[allow(unused_variables)]\npub mod stringutil {\nuse std::borrow::Cow;\n\n')
for rel, names in STRINGUTIL:
    for name in names:
        w(stub(rel, name, 0))
w('}\n\n')

w('pub mod ast {\n')
for rel in ['ast/flags.rs', 'ast/ids.rs', 'ast/checkflags.rs', 'ast/symbolflags.rs', 'ast/kind_generated.rs']:
    w(path_mod(rel))
w('''pub use checkflags::*;
pub use ids::*;
pub use kind_generated::*;
pub use symbolflags::*;

use crate::core::List;

// ast/diagnostic.rs 8
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Arg<'a> {
    Str(&'a [u8]),
    Int(i64),
    Bool(bool),
}

''')
w('// ast/symbol.rs\n')
w('pub type SymbolTable = SymbolTableId;\n')
w(block('ast/symbol.rs', 'pub struct Symbol<', 1))
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
w(path_mod(FILE))
w('''pub use c47_promised_mapped_template::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Arg, Ast, DiagnosticId, NodeId, SymbolId};
    use crate::checker::types::checker_flags;
    use crate::checker::types::*;
    use crate::core::{List, Map, Text};
    use crate::diagnostics::MessageId;
    use crate::jsnum::Number;

    // bun_core::StackCheck
    #[derive(Clone, Copy, Default)]
    pub struct StackCheck;
    impl StackCheck {
        pub fn is_safe_to_recurse(self) -> bool {
            true
        }
    }

    // checker/c30_type_keys.rs
''')
w(block('checker/c30_type_keys.rs', 'pub struct CacheHashKey', 1))
w('\n    // checker/c01_data.rs\n')
for name in C01_FLAGS:
    w(block('checker/c01_data.rs', 'checker_flags!(%s:' % name, 0))
for first in C01_RECORDS:
    w(block('checker/c01_data.rs', first, 1))
w(block('checker/c01_data.rs', 'pub fn intrinsic_type_kinds(', 0))
w('''
    // checker/c02_program_checker.rs 122 and 226: the bounds of the lists and of the fallbacks.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for TypeId {}
    impl<'a> ListItem<'a> for Text<'a> {}
    pub trait Fallback<'a>: Sized {
        fn fallback(c: &Checker<'a>) -> Self;
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
    fallback_default!((), bool, isize, TypeMapperId, CacheHashKey);
    impl<'a> Fallback<'a> for TypeId {
        fn fallback(c: &Checker<'a>) -> Self {
            c.error_type
        }
    }
    impl<'a> Fallback<'a> for Text<'a> {
        fn fallback(_: &Checker<'a>) -> Self {
            b""
        }
    }
    impl<'a, T: Copy + Default> Fallback<'a> for List<'a, T> {
        fn fallback(_: &Checker<'a>) -> Self {
            List::NIL
        }
    }

    // checker/c02_program_checker.rs 379-731: the fields that the file and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
''')
w('\n'.join(fields) + '\n')
w('''    }

    impl<'a> Checker<'a> {
''')
for rel, names in CHECKER_METHODS:
    for name in names:
        w(stub(rel, name, 4))
w('''        // checker.go 28250: no file of the tree has it at the time of writing. Its five callers pass a type and read a type.
        pub fn get_modifiers_type_from_mapped_type(&mut self, t: TypeId) -> TypeId {
            loop {}
        }
''')
w('    }\n\n')
for rel, names in CHECKER_FREE:
    for name in names:
        w(stub(rel, name, 0))
w('}\n')
w(CALLERS)
w('}\n')

with open(os.path.join(W, 'lib.rs'), 'w') as f:
    f.write(''.join(out))
print('%d fields of the Checker are named by %s' % (len(fields), FILE))
