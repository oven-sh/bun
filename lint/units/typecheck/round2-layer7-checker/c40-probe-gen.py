#!/usr/bin/env python3
# Writes lib.rs of a probe of checker/c40_type_nodes_conditional_tuples.rs into a work directory (argument 1, default
# /tmp/c40probe-run): the file of the tree and checker/types.rs by #[path], the leaf files they stand on by #[path], and a
# stand-in for every other name. What the file names is read from the file at the time of the run: the methods of the
# checker it calls, the methods of the tree context it calls, the fields of the checker it reads and the names it imports.
# The signature of a stand-in is read from the file of the tree that defines the function, and its body never returns; the
# type of a field is read from checker_fields! of c02_program_checker.rs. A callee that no file of the tree defines is
# written by hand in MISSING below, with upstream's name and parameter order, and is used only while the tree has none.
# The helpers are those of c20-probe-gen.py. Run: sh c40-probe.sh
import glob
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
W = sys.argv[1] if len(sys.argv) > 1 else '/tmp/c40probe-run'
SRC = 'checker/c40_type_nodes_conditional_tuples.rs'
CACHE = {}


def lines_of(rel):
    if rel not in CACHE:
        with open(os.path.join(ROOT, rel)) as f:
            CACHE[rel] = f.read().split('\n')
    return CACHE[rel]


def sig_at(ls, i):
    out = []
    while True:
        out.append(ls[i])
        if ls[i].rstrip().endswith('{'):
            break
        i += 1
    return re.sub(r'(?<![&\w])mut (\w+):', r'\1:', '\n'.join(out))


def find_fn(rels, name, indent, must=None):
    # The signatures of `name` at the indent in the files: (file, signature text).
    pat = re.compile(r'^' + ' ' * indent + r'pub(?:\(crate\))? (?:const )?fn ' + re.escape(name) + r'[<(]')
    hits = []
    for rel in rels:
        ls = lines_of(rel)
        for i, l in enumerate(ls):
            if pat.match(l):
                sig = sig_at(ls, i)
                if must is None or must(sig):
                    hits.append((rel, sig))
    return hits


def one_fn(rels, name, indent, must=None):
    hits = find_fn(rels, name, indent, must)
    if len(hits) != 1:
        sys.exit('%s at indent %d: %d definitions (%s)' % (name, indent, len(hits), ' '.join(h[0] for h in hits)))
    return hits[0]


def stub_of(rel, sig, indent):
    return '// %s\n%s\n%sloop {}\n%s}\n' % (rel, sig, ' ' * (indent + 4), ' ' * indent)


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


def rels_of(directory, skip=()):
    found = sorted(os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, directory, '*.rs')))
    return [r for r in found if r not in skip]


def use_list(text, path):
    m = re.search(r'^use ' + re.escape(path) + r'::\{(.*?)\};', text, re.S | re.M)
    if not m:
        m = re.search(r'^use ' + re.escape(path) + r'::(\w+);', text, re.M)
        return [m.group(1)] if m else []
    return [n.strip() for n in m.group(1).replace('\n', ' ').split(',') if n.strip()]


src = '\n'.join(lines_of(SRC))
types_rs = '\n'.join(lines_of('checker/types.rs'))
c02 = lines_of('checker/c02_program_checker.rs')

has_self = lambda sig: '&self' in sig or '&mut self' in sig
by_value = lambda sig: re.search(r'\(\s*self\b', sig) is not None

# The methods of the checker that the file calls and does not define.
own = set(re.findall(r'^    pub fn (\w+)[<(]', src, re.M))
called = sorted(set(re.findall(r'\b(?:self|c)\.(\w+)\(', src)) - own)


def in_types(name):
    return (re.search(r'^\s+pub fn %s[<(]' % name, types_rs, re.M) is not None
            or re.search(r'^\s+(?:\w+, )*%s, ' % name, types_rs, re.M) is not None)


# What checker/types.rs itself calls of the checker, beside its own casts.
TYPES_RS_METHODS = ['fail', 'bad_cast', 'list_of']
CHECKER_RELS = rels_of('checker', skip=(SRC, 'checker/types.rs'))
# The callees of c40 that no file of the tree defines: upstream's name in snake_case, upstream's parameter order, an id for a pointer.
MISSING = {
    # checker.go 10727
    'check_expression_with_type_arguments': '    pub fn check_expression_with_type_arguments(&mut self, node: NodeId) -> TypeId {',
    # checker.go 10750
    'get_instantiation_expression_type': '    pub fn get_instantiation_expression_type(&mut self, expr_type: TypeId, node: NodeId) -> TypeId {',
}
checker_stubs = []
missing_used = []
for name in sorted(set(called) | set(TYPES_RS_METHODS)):
    if in_types(name):
        continue
    hits = find_fn(CHECKER_RELS, name, 4, has_self)
    if len(hits) == 1:
        checker_stubs.append(stub_of(hits[0][0], hits[0][1], 4))
    elif len(hits) == 0 and name in MISSING:
        missing_used.append(name)
        checker_stubs.append(stub_of('no file of the tree: upstream', MISSING[name], 4))
    else:
        sys.exit('checker method %s: %d definitions (%s)' % (name, len(hits), ' '.join(h[0] for h in hits)))

# The names that the file imports from the packages.
checker_names = use_list(src, 'crate::checker')
ast_names = use_list(src, 'crate::ast')
core_names = use_list(src, 'crate::core')
scanner_names = use_list(src, 'crate::scanner')

checker_free = []
for name in sorted(set(n for n in checker_names if n[0].islower()) | {'is_tuple_type', 'value_to_string'}):
    rel, sig = one_fn(CHECKER_RELS, name, 0)
    checker_free.append(stub_of(rel, sig, 0))

AST_RELS = ['ast/utilities.rs', 'ast/ast_generated.rs']
ast_free = []
for name in sorted(n for n in ast_names if n[0].islower()):
    rel, sig = one_fn(AST_RELS, name, 0)
    ast_free.append(stub_of(rel, sig, 0))

# The methods of the tree context that the file calls, and the records that its casts return.
AST_METHOD_RELS = ['ast/node_methods.rs', 'ast/reader.rs', 'ast/symbol.rs', 'ast/ast_generated.rs']
ast_methods = []
ast_records = []
for name in sorted(set(re.findall(r'\b(?:a|self\.ast)\.(\w+)\(', src))):
    rel, sig = one_fn(AST_METHOD_RELS, name, 4, by_value)
    ast_methods.append(stub_of(rel, sig, 4))
    if name.startswith('as_'):
        ast_records.append(re.search(r'-> (\w+)', sig).group(1))

core_free = []
for name in sorted(n for n in core_names if n[0].islower()):
    rel, sig = one_fn(['core/core.rs'], name, 0)
    core_free.append(stub_of(rel, sig, 0))

scanner_free = []
for name in scanner_names:
    rel, sig = one_fn(['scanner/utilities.rs', 'scanner/scanner.rs'], name, 0)
    scanner_free.append(stub_of(rel, sig, 0))

# The fields of the checker that the file and types.rs read, with the types of checker_fields!.
SPECIAL = {'ast', 'lists', 'stack_check'}
fields = sorted((set(re.findall(r'\b(?:self|c)\.(\w+)\b(?!\()', src)) | {'types', 'nil_sections', 'sink_sections', 'error_type'}) - SPECIAL)
field_lines = []
for name in fields:
    hits = [m.group(1) for m in (re.match(r'^        %s: (.+),$' % name, l) for l in c02) if m]
    if len(hits) != 1:
        sys.exit('field %s of the checker: %d lines in checker_fields!' % (name, len(hits)))
    field_lines.append('        pub %s: %s,\n' % (name, hits[0]))

out = []
w = out.append
w('''//! Probe of %s: the file of the tree, by #[path], beside stand-ins for what it names. Written by c40-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: diagnostics/, core/{arena,golang,linkstore,text,tristate,tristate_stringer_generated}.rs, collections/{set,ordered_map,ordered_set}.rs, jsnum/jsnum.rs, ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs, checker/types.rs.
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unreachable_pub, unused_assignments)]

''' % SRC)
w(path_mod('diagnostics/mod.rs', 'diagnostics'))
w('\npub mod core {\n')
for rel in ['core/arena.rs', 'core/golang.rs', 'core/linkstore.rs', 'core/text.rs', 'core/tristate.rs',
            'core/tristate_stringer_generated.rs']:
    w(path_mod(rel))
w('''pub use golang::*;
pub use linkstore::*;
pub use text::*;
pub use tristate::*;

// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 152-222: a `[]T` that upstream writes after it shared it.
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

// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 223-268: `map[K]V` that nothing ranges over. The contract keeps a hash map: the probe keeps an ordered one, because clippy.toml disallows the hash map of std.
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
for text in core_free:
    w(text)
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
for name in sorted(set(ast_records)):
    w(block('ast/ast_generated.rs', 'pub struct %s {' % name, 1))
w('// ast/utilities.rs: the record and, to the first closing brace, its constants.\n')
w(block('ast/utilities.rs', 'pub struct JSDeclarationKind(', 2))
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
for text in ast_methods:
    w(text)
w('    }\n\n')
for text in ast_free:
    w(text)
w('}\npub use stand_ins::*;\n}\n\n')

w('''pub mod scanner {
#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Ast, NodeId};

''')
for text in scanner_free:
    w(text)
w('}\npub use stand_ins::*;\n}\n\n')

w('pub mod checker {\n')
w(path_mod('checker/types.rs'))
w(path_mod(SRC))
w('''pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{
        Arg, Ast, CheckFlags, DiagnosticId, DiagnosticStore, FlowNodeId, ModifierFlags, NodeFlags,
        NodeId, SymbolFlags, SymbolId, SymbolTableId,
    };
    use crate::checker::types::checker_flags;
    use crate::checker::types::*;
    use crate::core::{Link, LinkStore, List, LiveList, Map, Text};
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

    // checker/links.rs
    pub type NodeLinkStore<V> = LinkStore<NodeId, V>;
    pub type SymbolArenaLinkStore<V> = LinkStore<SymbolId, V>;

    // checker/c30_type_keys.rs
''')
w('    ' + block('checker/c30_type_keys.rs', 'pub struct CacheHashKey {', 1).replace('\n', '\n    ').rstrip(' '))
w('\n    // checker/c01_data.rs\n')
for name in ['CachedTypeKind', 'UnionReduction', 'IntersectionFlags', 'IntersectionState', 'InferenceFlags',
             'InferencePriority']:
    w(block('checker/c01_data.rs', 'checker_flags!(%s:' % name, 0))
for first in ['pub struct CachedTypeKey {', 'pub struct IntraExpressionInferenceSite {', 'pub struct InferenceContext<']:
    w('    ' + block('checker/c01_data.rs', first, 1).replace('\n', '\n    ').rstrip(' '))
w('\n    // checker/mapper.rs\n')
for first, back in [('pub enum Targets<', 1), ("impl<'a> From<List<'a, TypeId>> for Targets<'a> {", 0),
                    ("impl<'a> From<LiveList<'a, TypeId>> for Targets<'a> {", 0)]:
    w('    ' + block('checker/mapper.rs', first, back).replace('\n', '\n    ').rstrip(' '))
w('''
    // checker/c02_program_checker.rs 122 and 226: the bounds of the lists and of the fallbacks.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for TypeId {}
    impl<'a> ListItem<'a> for SymbolId {}
    impl<'a> ListItem<'a> for NodeId {}
    impl<'a> ListItem<'a> for SignatureId {}
    impl<'a> ListItem<'a> for IndexInfoId {}
    impl<'a> ListItem<'a> for TupleElementInfo {}
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
    fallback_default!(bool, isize, usize, NodeId, SymbolId, TypeMapperId, IndexInfoId, ConditionalRootId);
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
    impl<'a, T> Fallback<'a> for Vec<T> {
        fn fallback(_: &Checker<'a>) -> Self {
            Vec::new()
        }
    }
    impl<'a, A: Fallback<'a>, B: Fallback<'a>> Fallback<'a> for (A, B) {
        fn fallback(c: &Checker<'a>) -> Self {
            (A::fallback(c), B::fallback(c))
        }
    }

    // checker/c02_program_checker.rs 379-731: the fields that c40 and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
        pub stack_check: StackCheck,
''')
for text in field_lines:
    w(text)
w('''    }

    impl<'a> Checker<'a> {
''')
for text in checker_stubs:
    w(text)
w('    }\n\n')
for text in checker_free:
    w(text)
w('}\n}\n')

os.makedirs(W, exist_ok=True)
with open(os.path.join(W, 'lib.rs'), 'w') as f:
    f.write(''.join(out))
print('lib.rs: %d lines, %d method stand-ins, %d fields; not in the tree: %s' % (
    ''.join(out).count('\n'), len(checker_stubs), len(field_lines), ', '.join(missing_used) or 'none'))
