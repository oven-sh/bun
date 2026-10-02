#!/usr/bin/env python3
# Writes c04-probe.rs into a work directory: checker/c04_name_resolution_hooks.rs, checker/types.rs and
# checker/c01_data.rs of the tree by #[path], the leaf files they stand on by #[path], and stand-ins for every other
# name. The signature of a stand-in is read from the file of the tree that defines the function, at the time of the
# run; its body never returns. The three callees that no file of the tree defines yet (the range of c18) are written by
# hand in the block MISSING, with upstream's parameter order: when the file of their range has them, the signature of
# the tree replaces the hand-written one. Map and LiveList of crate::core are the contract's, until the tree has them.
# After the file come its consumers: the two functions of c03_init.rs that pass the hooks to the name resolver, as
# the tree has them, against the fields of binder/nameresolver.rs, and the calls that other files of checker/ make.
# The layout of this script is the one of c52-probe-gen.py.
# Run: sh c04-probe.sh
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/c04probe-run'
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
    hits = [l for l in lines_of(rel) if l.startswith(first)]
    if len(hits) != 1:
        sys.exit('%s: %s: %d lines' % (rel, first, len(hits)))
    return hits[0] + '\n'


AST_METHODS = [
    ('ast/node_methods.rs', ['name', 'locals', 'text', 'expression', 'members', 'initializer', 'postfix_token']),
    ('ast/reader.rs', [('kind', '(self, node: NodeId)'), ('parent', '(self, node: NodeId)'),
                       ('loc', '(self, node: NodeId)'), ('pos', '(self, node: NodeId)'),
                       ('end', '(self, node: NodeId)'), ('flags', '(self, node: NodeId)')]),
    ('ast/symbol.rs', ['sym', 'table_get', 'table_entry_at', 'new_symbol']),
    ('ast/ast_generated.rs', ['as_property_declaration', 'as_qualified_name', 'as_heritage_clause',
                              'as_export_assignment', 'as_decorator']),
]
AST_FREE = [
    ('ast/utilities.rs', [
        'find_ancestor', 'find_ancestor_kind', 'find_ancestor_or_quit', 'get_containing_class',
        'get_enclosing_block_scope_container', 'get_immediately_invoked_function_expression',
        'get_name_of_declaration', 'get_root_declaration', 'get_source_file_of_node', 'is_accessor',
        'is_ambient_module', 'is_block_or_catch_scoped', 'is_class_like', 'is_external_or_common_js_module',
        'is_for_in_or_of_statement', 'is_function_like', 'is_global_scope_augmentation',
        'is_parameter_property_declaration', 'is_static', 'is_type_only_import_declaration',
        'is_valid_type_only_alias_use_site', 'node_kind_is', 'to_find_ancestor_result']),
    ('ast/ast_generated.rs', [
        'is_binding_element', 'is_class_static_block_declaration', 'is_computed_property_name', 'is_decorator',
        'is_enum_declaration', 'is_export_assignment', 'is_export_declaration', 'is_export_specifier',
        'is_heritage_clause', 'is_identifier', 'is_method_declaration', 'is_namespace_export',
        'is_namespace_export_declaration', 'is_parameter_declaration', 'is_private_identifier',
        'is_property_declaration', 'is_property_signature_declaration', 'is_qualified_name', 'is_source_file',
        'is_type_literal_node']),
    ('ast/functionflags.rs', ['get_function_flags']),
    ('ast/symbol.rs', ['symbol_name']),
]
AST_RECORDS = ['PropertyDeclaration', 'QualifiedName', 'HeritageClause', 'ExportAssignment', 'Decorator']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'assert', 'bad_cast', 'stack_limit', 'loop_limit', 'list_of']),
    ('checker/c03_init.rs', ['resolve_name', 'resolve_name_for_symbol_suggestion', 'compare_symbols']),
    ('checker/c09_check_classes_interfaces.rs', ['is_property_initialized_in_static_blocks']),
    ('checker/c21_resolved_symbols_diagnostics.rs', ['error', 'error_or_suggestion', 'add_error_or_suggestion']),
    ('checker/c22_symbols_merge.rs', ['get_symbol_of_declaration', 'get_merged_symbol',
                                      'get_export_symbol_of_value_symbol_if_exported', 'get_late_bound_symbol',
                                      'resolve_symbol', 'create_diagnostic_for_node']),
    ('checker/c25_entity_names.rs', ['get_target_of_alias_declaration']),
    ('checker/c27_resolve_alias.rs', ['resolve_alias', 'try_resolve_alias', 'get_symbol_flags',
                                      'get_declaration_of_alias_symbol']),
    ('checker/c28_types_of_symbols.rs', ['get_type_of_symbol']),
    ('checker/c33_members_base_types_signatures.rs', ['get_property_of_type']),
    ('checker/c38_type_nodes_references.rs', ['get_declared_type_of_symbol']),
    ('checker/c45_base_constraints_normalization.rs', ['all_types_assignable_to_kind_ex']),
    ('checker/printer.rs', ['symbol_to_string']),
    ('checker/utilities.rs', ['new_diagnostic_for_node', 'is_unchecked_js_suggestion']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', [
        'get_feature_map', 'is_const_type_reference_name', 'is_exclamation_token',
        'is_export_assignment_expression_name', 'is_in_type_query', 'is_this_property',
        'is_type_reference_identifier', 'value_to_string']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
]
# The functions of core/core.rs that the file calls: the five that stand alone are the text of the tree.
CORE_WHOLE = ['filter', 'every', 'find', 'if_else', 'concatenate_seq']
CORE_FREE = ['get_spelling_suggestion_exported']

# The callees of c04 that no file of the tree defined when this was written: upstream's name in snake_case, upstream's parameter order, an id for a pointer.
MISSING = {
    'get_this_container': '''
        pub fn get_this_container(&self, node: NodeId, include_arrow_functions: bool, include_class_computed_property_name: bool) -> NodeId {
            loop {}
        }
''',
    'check_and_report_error_for_extending_interface': '''
        pub fn check_and_report_error_for_extending_interface(&mut self, error_location: NodeId) -> bool {
            loop {}
        }
''',
    'is_in_ambient_or_type_node': '''
        pub fn is_in_ambient_or_type_node(&self, node: NodeId) -> bool {
            loop {}
        }
''',
}
# Where a callee of MISSING lands by its upstream range.
MISSING_HOME = {
    'get_this_container': 'checker/c18_identifiers_property_access_this.rs',
    'check_and_report_error_for_extending_interface': 'checker/c18_identifiers_property_access_this.rs',
    'is_in_ambient_or_type_node': 'checker/c18_identifiers_property_access_this.rs',
}


def path_mod(rel, name=None):
    name = name or os.path.basename(rel)[:-3]
    return '#[path = "%s/%s"]\npub mod %s;\n' % (ROOT, rel, name)


out = []
w = out.append
w('''//! Probe of checker/c04_name_resolution_hooks.rs: the file of the tree, by #[path], beside stand-ins for what it names and the consumers of its functions. Written by c04-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: diagnostics/, internal.rs, core/{arena,golang,linkstore,text,tristate}.rs, collections/{set,ordered_map,ordered_set}.rs, ast/{flags,ids,checkflags,symbolflags,nodeflags,kind_generated,diagnostic}.rs, checker/{types,c01_data}.rs.
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

// core/compileroptions.rs: the two fields and the two methods that the file reads.
pub struct CompilerOptions {
''')
for field in ['allow_umd_global_access', 'isolated_modules']:
    w(line('core/compileroptions.rs', '    pub %s:' % field))
w('''}

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use super::*;
    use std::borrow::Cow;

    impl CompilerOptions {
''')
for name in ['get_emit_standard_class_fields', 'get_isolated_modules']:
    w(stub('core/compileroptions.rs', name, 4))
w('    }\n\n')
for name in CORE_WHOLE:
    w(whole_fn('core/core.rs', name, 0))
for name in CORE_FREE:
    w(stub('core/core.rs', name, 0))
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

#[allow(unused_variables, clippy::needless_pass_by_value)]
pub mod scanner {
    use crate::ast::{Ast, NodeId};

''')
w(stub('scanner/utilities.rs', 'declaration_name_to_string', 0))
w('''}

pub mod ast {
''')
for rel in ['ast/flags.rs', 'ast/ids.rs', 'ast/checkflags.rs', 'ast/symbolflags.rs', 'ast/nodeflags.rs',
            'ast/kind_generated.rs', 'ast/diagnostic.rs']:
    w(path_mod(rel))
w('''pub use checkflags::*;
pub use diagnostic::*;
pub use ids::*;
pub use kind_generated::*;
pub use nodeflags::*;
pub use symbolflags::*;

use crate::core::{List, TextRange};

''')
w('// ast/symbol.rs\n')
w('pub type SymbolTable = SymbolTableId;\n')
w(block('ast/symbol.rs', 'pub struct Symbol<', 1))
w('// ast/utilities.rs\n')
w(block('ast/utilities.rs', 'pub struct FindAncestorResult(', 2))
w(block('ast/utilities.rs', 'impl FindAncestorResult {', 0))
w('// ast/functionflags.rs\n')
w(block('ast/functionflags.rs', 'pub struct FunctionFlags(', 2))
w(block('ast/functionflags.rs', 'impl FunctionFlags {', 0))
w('// ast/ast_generated.rs\n')
for name in AST_RECORDS:
    w(block('ast/ast_generated.rs', 'pub struct %s {' % name, 1))
w('// ast/file.rs 562: the one field of the view of a source file that the file reads.\n')
w('#[derive(Clone, Copy)]\npub struct SourceFile<\'a> {\n')
w(line('ast/file.rs', '    pub global_exports:'))
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
w(stub('ast/reader.rs', 'as_source_file', 4))
w('    }\n\n')
for rel, names in AST_FREE:
    for name in names:
        w(stub(rel, name, 0))
w('}\npub use stand_ins::*;\n}\n\n')

w('pub mod checker {\n')
w(path_mod('checker/types.rs'))
w(path_mod('checker/c01_data.rs'))
w(path_mod('checker/c04_name_resolution_hooks.rs'))
w('''pub use c01_data::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Arg, Ast, DiagnosticId, DiagnosticStore, NodeId, SymbolFlags, SymbolId, SymbolTableId};
    use crate::checker::c01_data::*;
    use crate::checker::types::*;
    use crate::core::{CompilerOptions, Link, LinkStore, List, Map, Text, Tristate};
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

    // checker/utilities.rs: the map of getFeatureMap.
''')
w(block('checker/utilities.rs', 'pub struct FeatureMapEntry {', 1))
w(line('checker/utilities.rs', 'pub struct FeatureMap('))
w('impl FeatureMap {\n')
w(stub('checker/utilities.rs', ('get', 'FeatureMapEntry'), 4))
w('''}

    // checker/c02_program_checker.rs 379-731: the fields that c04, c03 and types.rs read, with the types of the tree.
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
c04 = '\n'.join(l for l in lines_of('checker/c04_name_resolution_hooks.rs') if not l.strip().startswith('//'))
named = sorted(set(re.findall(r'\bself\.(\w+)\b(?!\()', c04)) | set(re.findall(r'\bc\.(\w+)\b(?!\()', c04)))
written = {'ast', 'compiler_options', 'stack_check', 'types', 'diagnostic_store'}
for field in named + ['error_type', 'arguments_symbol', 'require_symbol']:
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
w('}\n\n')

w('''// The consumers of the file: what c03_init.rs passes to the name resolver, and the calls of other files of checker/.
pub mod consumers {
    use crate::ast::{Arg, DiagnosticId, NodeId, SymbolFlags, SymbolId, SymbolTableId};
    use crate::checker::Checker;
    use crate::core::{CompilerOptions, List, Tristate};
    use crate::diagnostics::MessageId;

    // binder/nameresolver.rs
''')
w(block('binder/nameresolver.rs', 'pub struct NameResolver<', 0))
w('''
    impl<'a> Checker<'a> {
''')
w(whole_fn('checker/c03_init.rs', 'create_name_resolver', 4))
w('\n')
w(whole_fn('checker/c03_init.rs', 'create_name_resolver_for_suggestion', 4))
w('''
        // c44_index_indexed_access.rs 1056, c09_check_classes_interfaces.rs 1082, jsx.rs 946 and c25_entity_names.rs 352
        pub fn spelling_suggestions(&mut self, name: &[u8], properties: List<'a, SymbolId>, node: NodeId) -> SymbolId {
            let a = self.ast;
            let symbol = self.get_spelling_suggestion_for_name(name, properties.as_slice(), SymbolFlags::VALUE);
            if !symbol.is_nil() {
                return symbol;
            }
            let symbols: Vec<SymbolId> = Vec::new();
            self.get_spelling_suggestion_for_name(a.text(node), &symbols, SymbolFlags::MODULE_MEMBER)
        }

        // c46_mark_references.rs 495-503 and 978, c27_resolve_alias.rs 121 and 164, c23_alias_targets.rs 177, c52_symbol_at_location.rs 61
        pub fn aliases(&mut self, symbol: SymbolId, exclude_type_only_meanings: bool) -> NodeId {
            self.symbol_referenced(symbol, SymbolFlags::ALL);
            if exclude_type_only_meanings && !self.get_type_only_alias_declaration(symbol).is_nil() {
                return NodeId::NIL;
            }
            let target = self.get_immediate_aliased_symbol(symbol);
            if !target.is_nil() {
                return self.get_type_only_alias_declaration(target);
            }
            NodeId::NIL
        }

        // c10_check_enums_modules_imports.rs 927 and 987, c13_check_aliases_unused.rs 161-190
        pub fn type_only(&mut self, id: NodeId, sym: SymbolId, message: MessageId, is_type: bool) {
            let a = self.ast;
            let type_only_declaration = self.get_type_only_alias_declaration_ex(sym, SymbolFlags::VALUE);
            let diagnostic = self.error(id, message, &[Arg::Str(a.text(id))]);
            self.add_type_only_declaration_related_info(diagnostic, type_only_declaration, a.text(id));
            let type_only_alias = self.get_type_only_alias_declaration(sym);
            let name = a.text(id);
            let diagnostic = self.error(id, message, &[Arg::Str(name)]);
            self.add_type_only_declaration_related_info(
                diagnostic,
                if is_type {
                    NodeId::NIL
                } else {
                    type_only_alias
                },
                name,
            );
        }

        // flow.rs 2826, c39_declared_types_enums.rs 512 and 584
        pub fn declared_before_use(&mut self, declaration: NodeId, location: NodeId) -> bool {
            location.is_nil()
                || declaration != location
                    && self.is_block_scoped_name_declared_before_use(declaration, location)
        }

        // emitresolver.go 850: the hook of binder/referenceresolver.rs 24.
        pub fn reference_resolver_hook(&self) -> Option<fn(&mut Checker<'a>, SymbolId, SymbolFlags) -> NodeId> {
            Some(Checker::get_type_only_alias_declaration_ex)
        }
    }
}
}
''')

os.makedirs(WORK, exist_ok=True)
with open(os.path.join(WORK, 'c04-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('c04-probe.rs: %d lines, %d callees written by hand' % (''.join(out).count('\n'), missing))
