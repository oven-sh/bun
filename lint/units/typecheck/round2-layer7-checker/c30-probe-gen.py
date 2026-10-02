#!/usr/bin/env python3
# Writes a probe of checker/c30_type_keys.rs into a work directory (argument 1, default /tmp/c30probe-run):
#   bun_core.rs  the one function of bun_core that the file names, with the signature that src/bun_core/util.rs has
#   lib.rs       the file of the tree and checker/types.rs by #[path], the leaf files they stand on by #[path], and a
#                stand-in for every other name: its signature is read from the file of the tree that defines it, at the
#                time of the run, and its body never returns (get_node_id and core::some are copied with their bodies)
#   run.rs       a program that drives the functions of the file that need no checker against a plain byte stream
# The helpers are those of c20-probe-gen.py. Run: sh c30-probe.sh
import os
import re
import sys

REPO = '/workspace/wt/typecheck'
ROOT = REPO + '/src/typecheck'
W = sys.argv[1] if len(sys.argv) > 1 else '/tmp/c30probe-run'
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


AST_METHODS = [
    ('ast/reader.rs', [('parent', '(self, node: NodeId)')]),
    ('ast/symbol.rs', ['sym', 'get_symbol_id']),
    ('ast/ast_generated.rs', ['as_type_parameter_declaration']),
]
AST_FREE = [
    ('ast/ast_generated.rs', ['is_infer_type_node', 'is_mapped_type_node', 'is_type_parameter_declaration']),
]
AST_RECORDS = ['TypeParameterDeclaration']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'bad_cast', 'stack_limit', 'list_of']),
    ('checker/c29_constraints.rs', ['get_constraint_of_type_parameter']),
    ('checker/c36_properties_apparent_types.rs', ['get_type_arguments']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', ['value_to_string']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
]

# bun_core: the function must be in the tree as the file calls it.
util = open(REPO + '/src/bun_core/util.rs').read()
lib = open(REPO + '/src/bun_core/lib.rs').read()
m = re.search(r'^pub mod hash \{\n(?:.*\n)*?^\}', util, re.M)
if not m or '    pub fn xxhash64(seed: u64, bytes: &[u8]) -> u64 {' not in m.group(0):
    sys.exit('src/bun_core/util.rs: no `pub fn xxhash64(seed: u64, bytes: &[u8]) -> u64` in `pub mod hash`')
if not re.search(r'^pub use util::\*;', lib, re.M) or not re.search(r'^pub mod util;', lib, re.M):
    sys.exit('src/bun_core/lib.rs: `util` is not re-exported at the root')
toml = open(ROOT + '/Cargo.toml').read()
if not re.search(r'^bun_core\.workspace = true', toml, re.M):
    sys.exit('src/typecheck/Cargo.toml: no bun_core dependency')

os.makedirs(W, exist_ok=True)
with open(os.path.join(W, 'bun_core.rs'), 'w') as f:
    f.write('''//! Stand-in of bun_core for the probe: `hash::xxhash64` with the signature of src/bun_core/util.rs. The digest is FNV-1a over the seed and the bytes, which is enough to tell two byte streams apart.
pub mod hash {
    pub fn xxhash64(seed: u64, bytes: &[u8]) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325 ^ seed;
        for b in bytes {
            h = (h ^ u64::from(*b)).wrapping_mul(0x0000_0100_0000_01b3);
        }
        h ^ (h >> 29)
    }
}
''')

out = []
w = out.append
w('''//! Probe of checker/c30_type_keys.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by c30-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: core/{golang,tristate,tristate_stringer_generated}.rs, collections/{set,ordered_map,ordered_set}.rs, ast/{flags,ids,checkflags,symbolflags}.rs, checker/types.rs, checker/c30_type_keys.rs.
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

// core/core.rs, with its body
''')
w(block('core/core.rs', 'pub fn some<', 0))
w('}\n\n')

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

pub mod ast {
''')
for rel in ['ast/flags.rs', 'ast/ids.rs', 'ast/checkflags.rs', 'ast/symbolflags.rs']:
    w(path_mod(rel))
w('''pub use checkflags::*;
pub use ids::*;
pub use symbolflags::*;

use crate::core::List;

''')
w('// ast/symbol.rs\n')
w('pub type SymbolTable = SymbolTableId;\n')
w(block('ast/symbol.rs', 'pub struct Symbol<', 1))
w('// ast/ast_generated.rs\n')
for name in AST_RECORDS:
    w(block('ast/ast_generated.rs', 'pub struct %s {' % name, 1))
w('// ast/utilities.rs, with its body\n')
w(block('ast/utilities.rs', 'pub fn get_node_id(', 0))
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
w(path_mod('checker/c30_type_keys.rs'))
w('''pub use c30_type_keys::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Ast, NodeId, SymbolId};
    use crate::checker::CacheHashKey;
    use crate::checker::types::checker_flags;
    use crate::checker::types::*;
    use crate::core::List;

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
for name in ['IntersectionFlags', 'IntersectionState']:
    w(block('checker/c01_data.rs', 'checker_flags!(%s:' % name, 0))
w('''
    // checker/c02_program_checker.rs 122 and 226: the bounds of the lists and of the fallbacks.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for TypeId {}
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
    fallback_default!(bool, TypeMapperId, CacheHashKey);
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

    // checker/c02_program_checker.rs 379-731: the fields that c30 and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
        pub stack_check: StackCheck,
        pub types: Records<TypeId, Type<'a>>,
        pub type_aliases: Records<TypeAliasId, TypeAlias<'a>>,
        pub nil_sections: NilSections<'a>,
        pub sink_sections: NilSections<'a>,
        pub error_type: TypeId,
    }

    impl<'a> Checker<'a> {
''')
for rel, names in CHECKER_METHODS:
    for name in names:
        w(stub(rel, name, 4))
w('    }\n\n')
for rel, names in CHECKER_FREE:
    for name in names:
        w(stub(rel, name, 0))
w('}\n}\n')

with open(os.path.join(W, 'lib.rs'), 'w') as f:
    f.write(''.join(out))

with open(os.path.join(W, 'run.rs'), 'w') as f:
    f.write(r'''//! Drives the functions of c30_type_keys.rs that need no checker: every key must be the digest of upstream's byte stream.
use bun_core::hash::xxhash64;
use c30probe::ast::NodeId;
use c30probe::checker::{
    CacheHashKey, ElementFlags, KeyBuilder, TupleElementInfo, TypeId, get_node_list_key,
    get_template_type_key, get_tuple_key, get_type_list_key,
};
use c30probe::core::List;

// A pseudo random sequence that is the same at every run.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self, bound: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % bound
    }
}

fn main() {
    // The digest: the two words are the two seeded digests, the zero value is the zero key.
    let key = CacheHashKey::of(b"-");
    assert_eq!(key.lo, xxhash64(0, b"-"));
    assert_eq!(key.hi, xxhash64(0x9E37_79B9_7F4A_7C15, b"-"));
    assert!(CacheHashKey::default().is_zero() && !key.is_zero());
    assert!(CacheHashKey::of(b"-") != CacheHashKey::of(b"*"));
    assert!(CacheHashKey::of(b"-") < CacheHashKey::of(b"*") || CacheHashKey::of(b"*") < CacheHashKey::of(b"-"));

    // A list of types is its length as 64 bits and each type id as 32 bits.
    let types = [TypeId(5), TypeId(9)];
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&2u64.to_le_bytes());
    bytes.extend_from_slice(&5u32.to_le_bytes());
    bytes.extend_from_slice(&9u32.to_le_bytes());
    assert_eq!(get_type_list_key(List::from_slice(&types)), CacheHashKey::of(&bytes));
    assert_eq!(get_type_list_key(List::NIL), CacheHashKey::of(&0u64.to_le_bytes()));
    assert_eq!(get_type_list_key(List::NIL), get_type_list_key(List::from_slice(&[])));

    // The empty builder, and the exact fill of the inline buffer by each write.
    assert_eq!(KeyBuilder::default().hash(), CacheHashKey::of(b""));
    let mut b = KeyBuilder::default();
    let mut model = Vec::new();
    for i in 0..192u32 {
        b.write_byte(i as u8);
        model.push(i as u8);
    }
    assert_eq!(b.hash(), CacheHashKey::of(&model));
    b.write_byte(0xAB);
    model.push(0xAB);
    assert_eq!(b.hash(), CacheHashKey::of(&model));
    let mut b = KeyBuilder::default();
    b.write_string(&[7u8; 192]);
    assert_eq!(b.hash(), CacheHashKey::of(&[7u8; 192]));
    b.write_string(b"");
    assert_eq!(b.hash(), CacheHashKey::of(&[7u8; 192]));
    let mut b = KeyBuilder::default();
    b.write_string(&[7u8; 193]);
    assert_eq!(b.hash(), CacheHashKey::of(&[7u8; 193]));
    for fill in 184..=192usize {
        let mut b = KeyBuilder::default();
        let mut model = vec![1u8; fill];
        b.write_string(&model);
        b.write_uint64(0x0102_0304_0506_0708);
        model.extend_from_slice(&0x0102_0304_0506_0708u64.to_le_bytes());
        b.write_uint32(0x0A0B_0C0D);
        model.extend_from_slice(&0x0A0B_0C0Du32.to_le_bytes());
        b.write_int(-2);
        model.extend_from_slice(&(-2i64).to_le_bytes());
        assert_eq!(b.hash(), CacheHashKey::of(&model), "fill {fill}");
    }

    // The key of the contract's test: it spills twice and ends in the inline buffer.
    let mut long = KeyBuilder::default();
    let mut expected = Vec::new();
    for i in 0..100u32 {
        long.write_uint32(i);
        expected.extend_from_slice(&i.to_le_bytes());
    }
    long.write_string(&[7u8; 300]);
    expected.extend_from_slice(&[7u8; 300]);
    long.write_byte(b'!');
    expected.push(b'!');
    assert_eq!(long.hash(), CacheHashKey::of(&expected));

    // 2,000 builders of up to 400 writes each against the plain byte stream, with a digest after each write.
    let mut rng = Lcg(0x1234_5678_9ABC_DEF0);
    let mut writes = 0u32;
    for _ in 0..2000 {
        let mut b = KeyBuilder::default();
        let mut model: Vec<u8> = Vec::new();
        let steps = rng.next(400);
        for _ in 0..steps {
            match rng.next(8) {
                0 => {
                    let c = rng.next(256) as u8;
                    b.write_byte(c);
                    model.push(c);
                }
                1 => {
                    let v = rng.next(u64::from(u32::MAX)) as u32;
                    b.write_uint32(v);
                    model.extend_from_slice(&v.to_le_bytes());
                }
                2 => {
                    let v = rng.next(u64::MAX);
                    b.write_uint64(v);
                    model.extend_from_slice(&v.to_le_bytes());
                }
                3 => {
                    let v = rng.next(1000) as isize - 500;
                    b.write_int(v);
                    model.extend_from_slice(&(v as i64).to_le_bytes());
                }
                4 => {
                    let t = TypeId(rng.next(1 << 20) as u32);
                    b.write_type(t);
                    model.extend_from_slice(&t.0.to_le_bytes());
                }
                5 => {
                    let n = NodeId(rng.next(3) as u32 * 77);
                    b.write_node(n);
                    if n.0 != 0 {
                        model.extend_from_slice(&u64::from(n.0).to_le_bytes());
                    }
                }
                6 => {
                    let list: Vec<TypeId> = (0..rng.next(6)).map(|i| TypeId(i as u32 + 3)).collect();
                    b.write_types(List::from_slice(&list));
                    model.extend_from_slice(&(list.len() as u64).to_le_bytes());
                    for t in &list {
                        model.extend_from_slice(&t.0.to_le_bytes());
                    }
                }
                _ => {
                    let len = match rng.next(4) {
                        0 => rng.next(4),
                        1 => rng.next(64),
                        2 => 180 + rng.next(30),
                        _ => rng.next(600),
                    } as usize;
                    let s: Vec<u8> = (0..len).map(|i| (i * 31 + 7) as u8).collect();
                    b.write_string(&s);
                    model.extend_from_slice(&s);
                }
            }
            writes += 1;
            assert_eq!(b.hash(), CacheHashKey::of(&model), "after {} bytes", model.len());
        }
    }

    // getTupleKey: one byte for the kind of an element, the id of its label when it has one, `!` for readonly.
    let infos = [
        TupleElementInfo { flags: ElementFlags::REQUIRED, labeled_declaration: NodeId::NIL },
        TupleElementInfo { flags: ElementFlags::OPTIONAL, labeled_declaration: NodeId(7) },
        TupleElementInfo { flags: ElementFlags::REST, labeled_declaration: NodeId::NIL },
        TupleElementInfo { flags: ElementFlags::VARIADIC, labeled_declaration: NodeId(9) },
    ];
    let mut bytes = vec![b'#', b'?'];
    bytes.extend_from_slice(&7u64.to_le_bytes());
    bytes.extend_from_slice(b".*");
    bytes.extend_from_slice(&9u64.to_le_bytes());
    assert_eq!(get_tuple_key(List::from_slice(&infos), false), CacheHashKey::of(&bytes));
    bytes.push(b'!');
    assert_eq!(get_tuple_key(List::from_slice(&infos), true), CacheHashKey::of(&bytes));
    assert_eq!(get_tuple_key(List::NIL, false), CacheHashKey::of(b""));

    // getTemplateTypeKey: the types, `|`, the length of each text, `|`, the texts.
    let texts: [&[u8]; 3] = [b"ab", b"", b"cde"];
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&2u64.to_le_bytes());
    bytes.extend_from_slice(&5u32.to_le_bytes());
    bytes.extend_from_slice(&9u32.to_le_bytes());
    bytes.push(b'|');
    for len in [2u64, 0, 3] {
        bytes.extend_from_slice(&len.to_le_bytes());
    }
    bytes.push(b'|');
    bytes.extend_from_slice(b"abcde");
    assert_eq!(get_template_type_key(List::from_slice(&texts), List::from_slice(&types)), CacheHashKey::of(&bytes));

    // getNodeListKey: the length, then the id of each node that is not nil.
    let nodes = [NodeId(3), NodeId::NIL, NodeId(4)];
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&3u64.to_le_bytes());
    bytes.extend_from_slice(&3u64.to_le_bytes());
    bytes.extend_from_slice(&4u64.to_le_bytes());
    assert_eq!(get_node_list_key(List::from_slice(&nodes)), CacheHashKey::of(&bytes));

    println!("c30_type_keys.rs: run ok ({writes} random writes)");
}
''')
print('%s: lib.rs %d lines, bun_core.rs, run.rs' % (W, ''.join(out).count('\n')))
