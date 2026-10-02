#!/usr/bin/env python3
# Writes c45-probe.rs into a work directory: one crate that holds, by #[path], the real leaf modules of the tree (core,
# collections, jsnum, stringutil, tspath, diagnostics, internal, ast, scanner) and, of checker/, the real types.rs,
# c01_data.rs, links.rs and c45_base_constraints_normalization.rs. Every other name of checker/ that those four files
# use is a stand-in: the Checker record with the fields they read (the types are read from the field list of
# c02_program_checker.rs), and a function for every method and free function that they call, whose signature is read
# from the file of the tree that defines it at the time of the run and whose body never returns. The call sites of
# the functions that c45 brings are compiled with it, as the other files of checker/ write them (module `callers`).
# bun_core and bun_collections are the real crates: c45-probe.sh passes the metadata that cargo left in target/.
# Run: sh c45-probe.sh
import glob
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/c45probe-run'
FILE = 'checker/c45_base_constraints_normalization.rs'
REAL = ['checker/types.rs', 'checker/c01_data.rs', 'checker/links.rs', FILE]
CACHE = {}


def lines_of(rel):
    if rel not in CACHE:
        with open(os.path.join(ROOT, rel)) as f:
            CACHE[rel] = f.read().split('\n')
    return CACHE[rel]


def find_sigs(rel, name, indent):
    ls = lines_of(rel)
    pat = re.compile(r'^' + ' ' * indent + r'pub(?:\(crate\))? (?:const )?fn ' + re.escape(name) + r'[<(]')
    sigs = []
    for i, l in enumerate(ls):
        if not pat.match(l):
            continue
        out = []
        while True:
            out.append(ls[i])
            if ls[i].rstrip().endswith('{'):
                break
            i += 1
        sigs.append(re.sub(r'(?<![&\w])mut (\w+):', r'\1:', '\n'.join(out)))
    return sigs


def block(rel, first, back):
    # The lines of an item: from `back` lines before the line that starts with `first` to the first line that is `}`.
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


def code_of(rel):
    return re.sub(r'//.*', '', '\n'.join(lines_of(rel)))


OTHERS = sorted(os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, 'checker', '*.rs'))
                if os.path.relpath(p, ROOT) not in REAL)


def locate(name, indent, prefer=None):
    # The one file of checker/, outside the real four, that defines the function at that indent.
    found = []
    for rel in OTHERS:
        for sig in find_sigs(rel, name, indent):
            found.append((rel, sig))
    if prefer is not None:
        found = [f for f in found if f[0] == prefer]
    if len(found) != 1:
        sys.exit('%s at indent %d: %d definitions: %s' % (name, indent, len(found), [f[0] for f in found]))
    return found[0]


def stub(name, indent, prefer=None):
    rel, sig = locate(name, indent, prefer)
    return '// %s\n%s\n%sloop {}\n%s}\n' % (rel, sig, ' ' * (indent + 4), ' ' * indent)


real_code = {rel: code_of(rel) for rel in REAL}
# What the real four define themselves: functions by `pub fn`, and the casts that the two macros of types.rs make.
defined = set()
for rel in REAL:
    defined |= set(re.findall(r'^\s*pub(?:\(crate\))? (?:const )?fn (\w+)', real_code[rel], re.M))
defined |= set(re.findall(r'\b((?:as|has)_\w+)\b', real_code['checker/types.rs']))

# Methods of the checker that c45 calls: every `self.name(` and `c.name(` of the file is one.
called = set(re.findall(r'\b(?:self|c)\s*\.(\w+)(?:::<[^>]*>)?\(', real_code[FILE]))
# Methods of the checker that types.rs, c01_data.rs and links.rs call: their `self.` is not always the checker.
called |= {'fail', 'bad_cast', 'map_set', 'stack_limit', 'list_of'}
methods = sorted(n for n in called if n not in defined)
# Two files define a method of these names: the one of the checker is named here.
PREFER = {'get_type_from_type_node': 'checker/c38_type_nodes_references.rs'}

# Free functions of checker/ that the real four import.
free = set()
for rel in REAL:
    for m in re.finditer(r'use crate::checker::\{(.*?)\};', real_code[rel], re.S):
        free |= set(n for n in re.findall(r'\b([a-z_0-9]+)\b', m.group(1)) if n not in ('types', 'checker_flags'))
free = sorted(n for n in free if n not in defined)
FREE_PREFER = {'value_to_string': 'checker/utilities.rs'}

# The fields of the Checker that the real four read, with the types of c02_program_checker.rs.
c02 = '\n'.join(lines_of('checker/c02_program_checker.rs'))
fields_block = re.search(r'\nchecker_fields! \{(.*?)\n\}\n', c02, re.S).group(1)
ftypes = dict(re.findall(r'^\s+(\w+):\s*(.+?),\s*$', re.sub(r'//.*', '', fields_block), re.M))
named = set()
for rel in REAL:
    named |= set(re.findall(r'\b(?:self|c)\s*\.(\w+)\b(?!\s*(?:\(|::<))', real_code[rel]))
# The fallback of a type is the error type, and the stores that the casts of types.rs read.
named |= {'ast', 'stack_check', 'types', 'type_aliases', 'nil_sections', 'sink_sections', 'error_type',
          'unknown_signature'}
fields = []
for f in sorted(named):
    if f not in ftypes or f == 'lists':
        continue
    t = ftypes[f].split(' = ')[0].strip()
    fields.append('        pub %s: %s,' % (f, t))

CALLERS = r'''
// What the other files of checker/ write at their call sites of the functions that c45 brings.
pub mod callers {
    use crate::ast::{NodeId, SymbolId};
    use crate::checker::{Checker, TypeFlags, TypeId};

    impl<'a> Checker<'a> {
        // c37_instantiation.rs 1053, c44_index_indexed_access.rs 386, c36_properties_apparent_types.rs 542, c47_promised_mapped_template.rs 198 and 577
        pub fn caller_modifiers_type(&mut self, target_type: TypeId) -> TypeId {
            let modifiers_type = self.get_modifiers_type_from_mapped_type(target_type);
            self.get_base_constraint_of_type(modifiers_type)
        }

        // relater.rs 1618
        pub fn caller_recursion_identity(c: &mut Checker<'_>, t: TypeId) -> bool {
            let target = c.get_modifiers_type_from_mapped_type(t);
            !target.is_nil()
        }

        // nodebuilderimpl.rs 2190, 2215, 2222, 2303, 2325
        pub fn caller_node_builder(c: &mut Checker<'a>, t: TypeId, target: TypeId) -> [TypeId; 2] {
            let modifiers_type = c.get_modifiers_type_from_mapped_type(t);
            if !c.types[modifiers_type].flags.intersects(TypeFlags::UNKNOWN) {
                return [modifiers_type, modifiers_type];
            }
            [
                c.get_constraint_type_from_mapped_type(target),
                c.get_modifiers_type_from_mapped_type(target),
            ]
        }

        // c44_index_indexed_access.rs 621, c19_assertions_binary_operators.rs 643
        pub fn caller_mark_access(&mut self, prop: SymbolId, access_expression: NodeId, is_self_type_access: bool) {
            self.mark_property_as_referenced(prop, access_expression, is_self_type_access);
        }

        // c11_check_variables_decorators.rs 109, c14_expressions.rs 763
        pub fn caller_mark(&mut self, property: SymbolId) {
            self.mark_property_as_referenced(property, NodeId::NIL, false);
        }

        // c29_constraints.rs 280 and 293
        pub fn caller_constraint_from_indexed_access(&mut self, object_type: TypeId, index_type: TypeId) -> TypeId {
            let index_constraint = self.get_simplified_type_or_constraint(index_type);
            if !index_constraint.is_nil() && index_constraint != index_type {
                return index_constraint;
            }
            let object_constraint = self.get_simplified_type_or_constraint(object_type);
            if !object_constraint.is_nil() && object_constraint != object_type {
                return object_constraint;
            }
            TypeId::NIL
        }

        // relater.rs 6180
        pub fn caller_relater(c: &mut Checker<'_>, target_type: TypeId) -> bool {
            let constraint = c.get_simplified_type_or_constraint(target_type);
            !constraint.is_nil()
        }

        // inference.rs 307-311
        pub fn caller_inference(&mut self, target: TypeId, target_object_type: TypeId, index_type: TypeId) -> bool {
            let object_type = self.get_simplified_type(target_object_type, false);
            let simplified = self.distribute_index_over_object_type(object_type, index_type, false);
            !simplified.is_nil() && simplified != target
        }
    }
}
'''

out = []
w = out.append
w('''//! Probe of checker/c45_base_constraints_normalization.rs: the file of the tree, by #[path], beside the real leaf modules and stand-ins for the rest of checker/. Written by c45-probe-gen.py: edit the script, not this file.
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unused_assignments)]

''')
for name, rel in [('core', 'core/mod.rs'), ('collections', 'collections/mod.rs'), ('jsnum', 'jsnum/mod.rs'),
                  ('stringutil', 'stringutil/mod.rs'), ('tspath', 'tspath/mod.rs'),
                  ('diagnostics', 'diagnostics/mod.rs'), ('internal', 'internal.rs'), ('ast', 'ast/mod.rs'),
                  ('scanner', 'scanner/mod.rs')]:
    w('#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name))
w('''
pub mod evaluator {
    // evaluator/evaluator.rs 9: the result that an enum member keeps.
    #[derive(Clone, Default, PartialEq, Debug)]
    pub struct Result<'a> {
        pub marker: std::marker::PhantomData<&'a ()>,
    }
}

pub mod checker {
''')
for rel in REAL:
    w('#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, os.path.basename(rel)[:-3]))
w('''pub use c01_data::*;
pub use c45_base_constraints_normalization::*;
pub use links::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value, clippy::trivially_copy_pass_by_ref)]
mod stand_ins {
    use crate::ast::*;
    use crate::checker::c01_data::*;
    use crate::checker::links::*;
    use crate::checker::types::*;
    use crate::core::*;
    use crate::diagnostics::MessageId;
    use crate::jsnum::Number;
    use bun_core::StackCheck;

    // checker/c30_type_keys.rs
''')
w('    ' + block('checker/c30_type_keys.rs', 'pub struct CacheHashKey {', 1).replace('\n', '\n    ').rstrip() + '\n')
w('''    impl CacheHashKey {
        pub fn of(bytes: &[u8]) -> Self {
            loop {}
        }
    }
''')
w('''
    // checker/c02_program_checker.rs: the bounds of the lists and of the fallbacks.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for TypeId {}
    impl<'a> ListItem<'a> for SymbolId {}
    impl<'a> ListItem<'a> for NodeId {}
    impl<'a> ListItem<'a> for SignatureId {}
    impl<'a> ListItem<'a> for IndexInfoId {}
    impl<'a> ListItem<'a> for TupleElementInfo {}
    impl<'a> ListItem<'a> for Text<'a> {}
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
    fallback_default!(bool, isize, usize, NodeId, SymbolId, TypeMapperId, IndexInfoId, CacheHashKey);
    impl<'a> Fallback<'a> for TypeId {
        fn fallback(c: &Checker<'a>) -> Self {
            c.error_type
        }
    }
    impl<'a> Fallback<'a> for SignatureId {
        fn fallback(c: &Checker<'a>) -> Self {
            c.unknown_signature
        }
    }
    impl<'a, T: Copy + Default> Fallback<'a> for List<'a, T> {
        fn fallback(_: &Checker<'a>) -> Self {
            List::NIL
        }
    }

    // checker/c02_program_checker.rs: the fields that the real files read, with the types of the tree.
    pub struct Checker<'a> {
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
''')
w('\n'.join(fields) + '\n')
w('''    }

    impl<'a> Checker<'a> {
''')
for name in methods:
    w(stub(name, 4, PREFER.get(name)))
w('    }\n\n')
for name in free:
    w(stub(name, 0, FREE_PREFER.get(name)))
w('}\n')
w(CALLERS)
w('}\n')

os.makedirs(WORK, exist_ok=True)
with open(os.path.join(WORK, 'c45-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('c45-probe.rs: %d lines, %d methods and %d free functions stand in, %d fields' % (
    ''.join(out).count('\n'), len(methods), len(free), len(fields)))
