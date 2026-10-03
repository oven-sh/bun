#!/usr/bin/env python3
# Writes symbolaccessibility-probe.rs into a work directory: checker/symbolaccessibility.rs of the tree by #[path], the
# leaf files it stands on by #[path], and stand-ins for every other name. The signature of a stand-in is read from the
# file of the tree that defines the function, at the time of the run, and its body never returns. A record of the tree
# (a struct, a flag set, a macro) is copied from its file as text. What the script writes by hand is checked against
# the tree with need(): the script stops when the tree no longer says it. The layout is the one of
# emitresolver-probe-gen.py.
# Run: sh symbolaccessibility-probe.sh
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/symbolaccessibility-probe-run'
CACHE = {}


def lines_of(rel):
    if rel not in CACHE:
        with open(os.path.join(ROOT, rel)) as f:
            CACHE[rel] = f.read().split('\n')
    return CACHE[rel]


def find_sig(rel, name, indent, public=True):
    # A name is `name` or `(name, text)`: the text is what the first line of the one wanted definition holds.
    must = ''
    if isinstance(name, tuple):
        name, must = name
    ls = lines_of(rel)
    head = r'pub(?:\(crate\))? (?:const )?fn ' if public else r'fn '
    pat = re.compile(r'^' + ' ' * indent + head + re.escape(name) + r'[<(]')
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


def fn_sig(rel, name, indent, public=True):
    sig, count = find_sig(rel, name, indent, public)
    if sig is None:
        sys.exit('%s: %s at indent %d: %d definitions' % (rel, name, indent, count))
    return sig


def stub(rel, name, indent, public=True):
    return '// %s\n%s\n%sloop {}\n%s}\n' % (rel, fn_sig(rel, name, indent, public), ' ' * (indent + 4), ' ' * indent)


def block(rel, first, back=0):
    # The lines of an item: from `back` lines before the one line that starts with `first` to the first line that is `}` or ends the macro call.
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


def region(rel, first, last):
    # The lines from the one line that starts with `first` to the line before the first later line that starts with `last`.
    ls = lines_of(rel)
    hits = [i for i, l in enumerate(ls) if l.startswith(first)]
    if len(hits) != 1:
        sys.exit('%s: %s: %d lines' % (rel, first, len(hits)))
    i = hits[0]
    j = i + 1
    while j < len(ls) and not ls[j].startswith(last):
        j += 1
    if j == len(ls):
        sys.exit('%s: no line %s after %s' % (rel, last, first))
    return '\n'.join(ls[i:j]) + '\n'


def line(rel, first):
    hits = [l for l in lines_of(rel) if l.startswith(first)]
    if len(hits) != 1:
        sys.exit('%s: %s: %d lines' % (rel, first, len(hits)))
    return hits[0] + '\n'


def need(rel, text):
    # What the script writes by hand holds only while the tree says this.
    if text not in '\n'.join(lines_of(rel)):
        sys.exit('%s no longer has: %s' % (rel, text))


def path_mod(rel, name=None):
    name = name or os.path.basename(rel)[:-3]
    return '#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name)


def indented(text):
    return ''.join('    ' + l + '\n' if l else '\n' for l in text.rstrip('\n').split('\n'))


AST_METHODS = [
    ('ast/node_methods.rs', ['name', 'locals', 'text', 'expression', 'type_node', 'initializer', 'module_specifier']),
    ('ast/reader.rs', [('kind', '(self, node: NodeId)'), ('parent', '(self, node: NodeId)'), 'as_source_file']),
    ('ast/symbol.rs', ['sym', 'new_table', 'table_get', 'table_entry_at', 'table_set']),
    ('ast/ast_generated.rs', ['as_binary_expression']),
]
AST_FREE = [
    ('ast/utilities.rs', [
        'find_ancestor', 'get_declaration_of_kind', 'get_reparsed_node_for_node', 'get_source_file_of_node',
        'get_symbol_id', 'is_access_expression', 'is_ambient_module', 'is_entity_name_expression',
        'is_exports_identifier', 'is_external_module', 'is_external_module_import_equals_declaration',
        'is_external_or_common_js_module', 'is_global_source_file', 'is_in_js_file',
        'is_module_exports_access_expression', 'is_module_with_string_literal_name', 'node_is_synthesized']),
    ('ast/ast_generated.rs', [
        'is_binary_expression', 'is_class_expression', 'is_module_block', 'is_namespace_export',
        'is_namespace_export_declaration', 'is_object_literal_expression', 'is_source_file', 'is_type_literal_node',
        'is_variable_declaration']),
]
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['stack_limit', 'map_set', 'list']),
    ('checker/c03_init.rs', ['compare_symbols']),
    ('checker/c14_expressions.rs', ['check_expression_cached']),
    ('checker/c22_symbols_merge.rs', ['get_merged_symbol', 'get_parent_of_symbol', 'get_symbol_if_same_reference',
                                      'get_symbol_of_declaration']),
    ('checker/c24_external_modules.rs', ['resolve_external_module_name', 'resolve_external_module_symbol']),
    ('checker/c26_exports_late_binding.rs', ['get_exports_of_symbol']),
    ('checker/c27_resolve_alias.rs', ['resolve_alias', 'get_symbol_flags']),
    ('checker/c28_types_of_symbols.rs', ['get_type_of_symbol']),
    ('checker/c38_type_nodes_references.rs', ['get_declared_type_of_symbol']),
    ('checker/printer.rs', ['symbol_to_string', 'symbol_to_string_ex']),
    ('checker/utilities.rs', ['sort_symbols']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', ['can_have_locals', 'get_declarations_of_kind']),
]
# The fields of the checker that the file reads and writes: the type of each is the one of checker/c02_program_checker.rs.
CHECKER_FIELDS = ['program', 'types', 'globals', 'global_this_symbol', 'symbol_table_alias_cache',
                  'class_expression_name_tables', 'symbol_node_links', 'symbol_container_links']

out = []
w = out.append
w('''//! Probe of checker/symbolaccessibility.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by symbolaccessibility-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: ast/{flags,ids,checkflags,symbolflags,kind_generated}.rs, core/{arena,linkstore,golang}.rs, printer/emitresolver.rs, checker/symbolaccessibility.rs.
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unreachable_pub, unused_assignments)]

''')

# core
w('pub mod core {\n')
for rel in ['core/arena.rs', 'core/linkstore.rs', 'core/golang.rs']:
    w(path_mod(rel))
w('pub use golang::*;\npub use linkstore::*;\n}\n\n')

# ast
need('ast/file.rs', 'pub struct SourceFile<\'a> {')
w('pub mod ast {\n')
for rel in ['ast/flags.rs', 'ast/ids.rs', 'ast/checkflags.rs', 'ast/symbolflags.rs', 'ast/kind_generated.rs']:
    w(path_mod(rel))
w('''pub use checkflags::*;
pub use ids::*;
pub use kind_generated::*;
pub use symbolflags::*;

use crate::core::List;

''')
w('// ast/symbol.rs\n')
w(line('ast/symbol.rs', 'pub type SymbolTable = '))
w(block('ast/symbol.rs', 'pub struct Symbol<', 1))
w(line('ast/symbol.rs', 'pub const INTERNAL_SYMBOL_NAME_EXPORT_EQUALS:'))
w(line('ast/symbol.rs', 'pub const INTERNAL_SYMBOL_NAME_DEFAULT:'))
w('// ast/ast_generated.rs\n')
w(block('ast/ast_generated.rs', 'pub struct BinaryExpression {', 1))
w('''
// ast/file.rs: the view of a source file, of which the file reads the imports.
pub struct SourceFile<'a> {
    pub marker: std::marker::PhantomData<&'a ()>,
}

// Invariant in its lifetime, as the context of the tree is: it names stores with interior mutability.
#[derive(Clone, Copy)]
pub struct Ast<'a> {
    pub marker: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
}

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use super::*;

    impl<'a> SourceFile<'a> {
''')
w(stub('ast/file.rs', 'imports', 4))
w('''    }

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

# printer
w('pub mod printer {\n')
w(path_mod('printer/emitresolver.rs'))
w('pub use emitresolver::*;\n}\n\n')

# checker
types = 'checker/types.rs'
c02rel = 'checker/c02_program_checker.rs'
need(types, '#[derive(Default)]\npub struct Type<\'a> {\n    pub flags: TypeFlags,')
need('checker/links.rs', 'pub type NodeLinkStore<V> = LinkStore<NodeId, V>;')
need(c02rel, 'pub trait Fallback<\'a>: Sized {\n    fn fallback(c: &Checker<\'a>) -> Self;\n}')
need(c02rel, 'pub trait ListItem<\'a>: Copy + Default + \'a {')
need(c02rel, '        symbol_ids: SymbolId,')
need(c02rel, '        ast: Ast<\'a>,')
need(c02rel, '        lists: &\'a CheckerArena<\'a>,')
need(c02rel, '        stack_check: StackCheck = StackCheck::init(),')
need(c02rel, 'fallback_default!(\n    (),')
need(c02rel, 'pub trait Program<\'p> {')
need(c02rel, '    fn source_files(&self) -> &\'p [NodeId];')
need('checker/emitresolver.rs', '#[derive(Clone, Copy, Default)]\npub struct EmitResolver;')
need('checker/mod.rs', 'pub use symbolaccessibility::*;')
w('pub mod checker {\n')
w(path_mod('checker/symbolaccessibility.rs'))
w('''pub use stand_ins::*;
pub use symbolaccessibility::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Ast, Id, Kind, NodeId, OPEN_BIT, SymbolFlags, SymbolId, SymbolTableId};
    use crate::checker::symbolaccessibility::SymbolTableID;
    use crate::core::{LinkStore, List, Map};
    use crate::printer::SymbolAccessibilityResult;
    use std::cell::Cell;
    use std::marker::PhantomData;
    use std::ops::{Index, IndexMut};

    // checker/types.rs
''')
w(indented(region(types, 'macro_rules! checker_flags {', 'pub(crate) use checker_flags;')))
w(indented(region(types, 'macro_rules! define_checker_id {', '// The records of one id space')))
w(indented(region(types, 'pub struct Records<I, T> {', '// `s[lo:hi]` of a list that a record keeps')))
for first in ['pub struct AccessibleChainCacheKey {', 'pub struct ContainingSymbolLinks<', 'pub struct SymbolNodeLinks {']:
    w(indented(block(types, first, 1)))
w(indented(block(types, 'checker_flags!(SymbolFormatFlags: u32 {')))
w(indented(block(types, 'checker_flags!(TypeFlags: u32 {')))
w('''
    // checker/types.rs: the member of a type that the file reads.
    #[derive(Default)]
    pub struct Type<'a> {
        pub flags: TypeFlags,
        pub marker: PhantomData<&'a ()>,
    }

    // bun_core::StackCheck
    #[derive(Clone, Copy, Default)]
    pub struct StackCheck;
    impl StackCheck {
        pub fn is_safe_to_recurse(self) -> bool {
            true
        }
    }

    // checker/c02_program_checker.rs: the bounds of the lists and of the fallbacks, and the one method of the program that the file calls.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for SymbolId {}
    pub trait Fallback<'a>: Sized {
        fn fallback(c: &Checker<'a>) -> Self;
    }
    impl<'a> Fallback<'a> for () {
        fn fallback(_: &Checker<'a>) -> Self {}
    }
    pub trait Program<'p> {
        fn source_files(&self) -> &'p [NodeId];
    }

    // checker/emitresolver.rs
    #[derive(Clone, Copy, Default)]
    pub struct EmitResolver;

    impl EmitResolver {
''')
w(stub('checker/emitresolver.rs', 'has_visible_declarations', 4))
w('''    }

    // checker/c02_program_checker.rs: the fields that the file reads and writes, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: PhantomData<Cell<&'a ()>>,
        pub stack_check: StackCheck,
''')
c02 = '\n'.join(lines_of(c02rel))
fields_block = re.search(r'checker_fields! \{(.*?)\n\}\n', c02, re.S).group(1)
ftypes = dict(re.findall(r'^\s+(\w+):\s*(.+?),\s*$', fields_block, re.M))
for field in CHECKER_FIELDS:
    if field not in ftypes:
        sys.exit('c02_program_checker.rs has no field %s' % field)
    t = ftypes[field]
    t = re.sub(r'^NodeLinkStore<', 'LinkStore<NodeId, ', t)
    w('        pub %s: %s,\n' % (field, t))
w('''    }

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

os.makedirs(WORK, exist_ok=True)
with open(os.path.join(WORK, 'symbolaccessibility-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('symbolaccessibility-probe.rs: %d lines' % ''.join(out).count('\n'))
