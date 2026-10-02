#!/usr/bin/env python3
# Writes emitresolver-probe.rs into a work directory: checker/emitresolver.rs of the tree by #[path], the leaf files it
# stands on by #[path], and stand-ins for every other name. The signature of a stand-in is read from the file of the
# tree that defines the function, at the time of the run, and its body never returns. A record of the tree (a struct, a
# flag set, a trait) is copied from its file as text. What the script writes by hand is checked against the tree with
# need(): the script stops when the tree no longer says it. The callees that no file of the tree defines yet are in
# the block MISSING, with upstream's parameter order: when the file of their upstream range has them, the signature of
# the tree replaces the hand-written one. The layout of this script is the one of c52-probe-gen.py.
# Run: sh emitresolver-probe.sh
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/emitresolver-probe-run'
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


AST_METHODS = [
    ('ast/node_methods.rs', ['name', 'elements', 'expression', 'text', 'symbol', 'body', 'initializer', 'type_node',
                             'question_token', 'modifier_flags', 'modifier_nodes', 'parameter_list',
                             'property_name_or_name', 'for_each_child']),
    ('ast/reader.rs', [('kind', '(self, node: NodeId)'), ('parent', '(self, node: NodeId)'),
                       ('flags', '(self, node: NodeId)'), 'as_source_file']),
    ('ast/symbol.rs', ['sym', 'table_entry_at']),
    ('ast/ast_generated.rs', ['as_binary_expression', 'as_export_declaration', 'as_import_equals_declaration',
                              'as_type_predicate_node', 'as_qualified_name']),
]
AST_FREE = [
    ('ast/utilities.rs', [
        'get_assignment_declaration_kind', 'get_declaration_container', 'get_first_identifier', 'get_node_id',
        'get_source_file_of_node', 'get_symbol_id', 'has_syntactic_modifier', 'is_alias_symbol_declaration',
        'is_binding_pattern', 'is_entity_name_expression', 'is_enum_const', 'is_expando_property_declaration',
        'is_external_module_augmentation', 'is_function_like_declaration', 'is_global_source_file',
        'is_implicitly_exported_jsdoc_declaration', 'is_in_js_file', 'is_internal_module_import_equals_declaration',
        'is_late_visibility_painted_statement', 'is_non_local_alias', 'is_parse_tree_node', 'is_part_of_type_node',
        'is_this_identifier', 'is_type_only_import_or_export_declaration', 'is_var_const', 'node_is_missing',
        'node_is_present', 'walk_up_binding_elements_and_patterns']),
    ('ast/ast_generated.rs', [
        'is_binary_expression', 'is_binding_element', 'is_computed_property_name', 'is_export_assignment',
        'is_export_declaration', 'is_expression_statement', 'is_get_accessor_declaration', 'is_identifier',
        'is_import_declaration', 'is_import_equals_declaration', 'is_namespace_export', 'is_parameter_declaration',
        'is_property_access_expression', 'is_qualified_name', 'is_set_accessor_declaration', 'is_source_file',
        'is_variable_declaration', 'is_variable_statement']),
]
AST_RECORDS = ['BinaryExpression', 'ExportDeclaration', 'ImportEqualsDeclaration', 'TypePredicateNode',
               'QualifiedName']
# The constructors and the update of the node factory that the file calls: default methods of the two traits.
FACTORY_METHODS = ['new_identifier', 'new_property_declaration', 'new_keyword_expression', 'new_string_literal',
                   'new_numeric_literal', 'new_big_int_literal', 'new_prefix_unary_expression',
                   'new_keyword_type_node', 'new_modifier']
UPDATER_METHODS = ['update_index_signature_declaration']
CHECKER_METHODS = [
    ('checker/c02_program_checker.rs', ['fail', 'stack_limit', 'stand_in', 'list_of', 'text']),
    ('checker/jsx.rs', ['get_jsx_factory_entity', 'get_jsx_fragment_factory_entity']),
    ('checker/utilities.rs', ['is_optional_parameter']),
    ('checker/c03_init.rs', ['resolve_name', 'get_global_symbol', 'get_global_promise_constructor_symbol']),
    ('checker/c04_name_resolution_hooks.rs', ['get_type_only_alias_declaration',
                                              'get_type_only_alias_declaration_ex']),
    ('checker/c06_check_members_type_nodes.rs', ['get_resolution_mode_override']),
    ('checker/c07_check_functions.rs', ['get_effective_declaration_flags']),
    ('checker/c14_expressions.rs', ['check_expression_cached']),
    ('checker/c20_object_literals_spread.rs', ['is_readonly_symbol']),
    ('checker/c21_resolved_symbols_diagnostics.rs', ['get_resolved_symbol', 'get_resolved_symbol_or_nil',
                                                     'get_referenced_value_or_alias_symbol']),
    ('checker/c22_symbols_merge.rs', ['get_symbol_of_declaration', 'get_merged_symbol', 'get_parent_of_symbol',
                                      'get_export_symbol_of_value_symbol_if_exported']),
    ('checker/c23_alias_targets.rs', ['get_target_of_export_specifier']),
    ('checker/c24_external_modules.rs', ['get_external_module_file_from_declaration',
                                         'resolve_external_module_symbol']),
    ('checker/c25_entity_names.rs', ['resolve_entity_name']),
    ('checker/c26_exports_late_binding.rs', ['get_exports_of_module', 'get_members_of_symbol']),
    ('checker/c27_resolve_alias.rs', ['get_symbol_flags', 'get_symbol_flags_ex', 'resolve_alias',
                                      'get_declaration_of_alias_symbol']),
    ('checker/c28_types_of_symbols.rs', ['get_type_of_symbol', 'is_constructor_type', 'is_function_type']),
    ('checker/c31_binding_patterns_widening.rs', ['get_combined_modifier_flags_cached']),
    ('checker/c33_members_base_types_signatures.rs', [
        'get_signatures_of_symbol', 'get_index_infos_of_type', 'get_index_symbol',
        'get_index_infos_of_index_symbol', 'has_late_bindable_name', 'get_properties_of_type', 'get_base_types',
        'get_property_of_type']),
    ('checker/c34_return_types.rs', ['get_signature_of_full_signature_type']),
    ('checker/c38_type_nodes_references.rs', ['get_type_from_type_node', 'get_declared_type_of_symbol',
                                              'is_array_type']),
    ('checker/c39_declared_types_enums.rs', ['compute_enum_member_values', 'get_enum_member_value']),
    ('checker/c43_unions_intersections.rs', ['is_error_type']),
    ('checker/c45_base_constraints_normalization.rs', ['contains_undefined_type', 'is_type_assignable_to_kind']),
    ('checker/c46_mark_references.rs', ['mark_linked_references']),
    ('checker/flow.rs', ['try_get_element_access_expression_name']),
    ('checker/relater.rs', ['is_type_identical_to']),
    ('checker/symbolaccessibility.rs', ['is_symbol_accessible']),
]
CHECKER_FREE = [
    ('checker/utilities.rs', ['contains_non_missing_undefined_type', 'get_any_import_syntax',
                              'is_declaration_readonly', 'is_optional_declaration', 'pseudo_big_int_to_string']),
    ('checker/c38_type_nodes_references.rs', ['is_tuple_type']),
    ('checker/c42_literal_types.rs', ['is_fresh_literal_type']),
    ('checker/c45_base_constraints_normalization.rs', ['is_const_enum_symbol']),
]
# The fields of the checker that the file reads and writes: the type of each is the one of checker/c02_program_checker.rs.
CHECKER_FIELDS = ['emit_resolver', 'enum_member_links', 'mapped_symbol_links', 'reverse_mapped_symbol_links',
                  'alias_symbol_links', 'symbol_node_links', 'types', 'signatures', 'index_infos',
                  'can_collect_symbol_alias_accessibility_data', 'strict_null_checks', 'true_type', 'false_type',
                  'any_base_type_index_info', 'unknown_symbol', 'global_this_symbol']

# The callees of the file that no file of the tree defined when this was written: upstream's name in snake_case, upstream's parameter order, an id for a pointer.
MISSING = {
    'get_this_container': '''
        pub fn get_this_container(&mut self, node: NodeId, include_arrow_functions: bool, include_class_computed_property_name: bool) -> NodeId {
            loop {}
        }
''',
}
# Where a callee of MISSING lands by its upstream range.
MISSING_HOME = {
    'get_this_container': 'checker/c18_identifiers_property_access_this.rs',
}

out = []
w = out.append
w('''//! Probe of checker/emitresolver.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by emitresolver-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,tokenflags,kind_generated}.rs, core/{arena,linkstore,tristate,tristate_stringer_generated}.rs, collections/set.rs, jsnum/jsnum.rs, nodebuilder/types.rs, printer/emitresolver.rs, checker/emitresolver.rs.
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unreachable_pub, unused_assignments)]

''')

# diagnostics
need('diagnostics/mod.rs', 'pub struct MessageId(pub u32);')
need('diagnostics/mod.rs', '    pub const NIL: Self = Self(0);')
w('''pub mod diagnostics {
    // diagnostics/mod.rs
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
    pub struct MessageId(pub u32);
    impl MessageId {
        pub const NIL: Self = Self(0);
    }
}

''')

# core
w('pub mod core {\n')
for rel in ['core/arena.rs', 'core/linkstore.rs', 'core/tristate.rs', 'core/tristate_stringer_generated.rs']:
    w(path_mod(rel))
w('pub use linkstore::*;\npub use tristate::*;\n\n')
w('// core/golang.rs: Text, GoIndex and List, as the file has them before LiveList.\n')
golang = region('core/golang.rs', 'pub type Text', '// A `[]T` that upstream writes after it shared it')
w('// `string` where a record keeps it or a function hands it on.\n' + golang)
w('// core/core.rs\n')
w(block('core/core.rs', 'pub fn some<'))
w(block('core/core.rs', 'pub fn every<'))
need('core/compileroptions.rs', 'pub type ResolutionMode = ModuleKind;')
need('core/compileroptions.rs', '#[derive(Clone, Default, Debug)]\npub struct CompilerOptions {')
w('''
// core/compileroptions.rs
''')
w('#[repr(transparent)]\n#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]\npub struct ModuleKind(pub i32);\n')
need('core/compileroptions.rs',
     '#[repr(transparent)]\n#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]\npub struct ModuleKind(pub i32);')
w('''pub type ResolutionMode = ModuleKind;

#[derive(Clone, Default, Debug)]
pub struct CompilerOptions {
    pub marker: (),
}

#[allow(unused_variables)]
mod stand_ins {
    use super::*;

    impl CompilerOptions {
''')
w(stub('core/compileroptions.rs', 'should_preserve_const_enums', 4))
w('    }\n}\n}\n\n')

# collections
w('pub mod collections {\n')
w(path_mod('collections/set.rs'))
w('pub use set::*;\n}\n\n')

# jsnum
need('jsnum/pseudobigint.rs',
     '#[derive(Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]\npub struct PseudoBigInt {')
w('pub mod jsnum {\n')
w(path_mod('jsnum/jsnum.rs'))
w('''pub use jsnum::*;

// jsnum/pseudobigint.rs
#[derive(Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct PseudoBigInt {
    pub negative: bool,
    pub base10_value: Vec<u8>,
}

#[allow(unused_variables)]
mod stand_ins {
    use super::*;

    impl Number {
''')
w(stub('jsnum/string.rs', 'string', 4))
w('    }\n}\n}\n\n')

# evaluator
w('pub mod evaluator {\n    use crate::checker::LiteralValue;\n\n')
w('    // evaluator/evaluator.rs\n')
w(''.join('    ' + l + '\n' if l else '\n' for l in block('evaluator/evaluator.rs', 'pub struct Result<', 1).rstrip('\n').split('\n')))
w(''.join('    ' + l + '\n' if l else '\n' for l in block('evaluator/evaluator.rs', 'pub fn new_result<').rstrip('\n').split('\n')))
need('evaluator/mod.rs', 'pub use evaluator::*;')
w('}\n\n')

# nodebuilder
w('pub mod nodebuilder {\n// The file shares its flag macro with printer/emitcontext.rs, which is not here.\n#[allow(unused_imports)]\n')
w(path_mod('nodebuilder/types.rs'))
w('pub use types::*;\n}\n\n')

# ast
w('pub mod ast {\n')
for rel in ['ast/flags.rs', 'ast/ids.rs', 'ast/checkflags.rs', 'ast/symbolflags.rs', 'ast/modifierflags.rs',
            'ast/nodeflags.rs', 'ast/tokenflags.rs', 'ast/kind_generated.rs']:
    w(path_mod(rel))
w('''pub use checkflags::*;
pub use ids::*;
pub use kind_generated::*;
pub use modifierflags::*;
pub use nodeflags::*;
pub use symbolflags::*;
pub use tokenflags::*;

use crate::core::List;

''')
w('// ast/symbol.rs\n')
w('pub type SymbolTable = SymbolTableId;\n')
w(block('ast/symbol.rs', 'pub struct Symbol<', 1))
w('// ast/ast_generated.rs\n')
for name in AST_RECORDS:
    w(block('ast/ast_generated.rs', 'pub struct %s {' % name, 1))
w('// ast/utilities.rs\n')
w(region('ast/utilities.rs', 'pub struct JSDeclarationKind(', 'pub fn get_assignment_declaration_kind').replace(
    'pub struct JSDeclarationKind(',
    '#[repr(transparent)]\n#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]\npub struct JSDeclarationKind('))
need('ast/utilities.rs',
     '#[repr(transparent)]\n#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]\npub struct JSDeclarationKind(pub i32);')
need('ast/file.rs', '    pub common_js_module_indicator: NodeId,')
need('ast/file.rs', 'pub struct SourceFile<\'a> {')
need('ast/factory.rs', 'pub trait NodeSink {')
need('ast/factory.rs', '    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId;')
need('ast/factory.rs', 'pub trait NodeUpdate: NodeSink {')
need('ast/ast_generated.rs', 'pub trait NodeFactory: NodeSink {')
need('ast/ast_generated.rs', 'impl<T: NodeSink + ?Sized> NodeFactory for T {}')
need('ast/ast_generated.rs', 'pub trait NodeUpdater: NodeUpdate {')
need('ast/ast_generated.rs', 'impl<T: NodeUpdate + ?Sized> NodeUpdater for T {}')
w('''
// ast/file.rs: the one member of the view of a source file that the file reads.
pub struct SourceFile<'a> {
    pub common_js_module_indicator: NodeId,
    pub marker: std::marker::PhantomData<&'a ()>,
}

// Invariant in its lifetime, as the context of the tree is: it names stores with interior mutability.
#[derive(Clone, Copy)]
pub struct Ast<'a> {
    pub marker: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
}

// ast/factory.rs: the one required method that the file calls.
pub trait NodeSink {
    fn new_modifier_list(&mut self, nodes: &[NodeId]) -> ModifierListId;
}

pub trait NodeUpdate: NodeSink {}

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use super::*;

    // ast/ast_generated.rs: the default methods that the file calls.
    pub trait NodeFactory: NodeSink {
''')
for name in FACTORY_METHODS:
    w(stub('ast/ast_generated.rs', name, 4, public=False))
w('''    }

    impl<T: NodeSink + ?Sized> NodeFactory for T {}

    pub trait NodeUpdater: NodeUpdate {
''')
for name in UPDATER_METHODS:
    w(stub('ast/ast_generated.rs', name, 4, public=False))
w('''    }

    impl<T: NodeUpdate + ?Sized> NodeUpdater for T {}

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
need('printer/factory.rs', 'pub struct NodeFactory<\'a, \'c> {')
need('printer/factory.rs', 'impl NodeSink for NodeFactory<\'_, \'_> {')
need('printer/factory.rs', 'impl NodeUpdate for NodeFactory<\'_, \'_> {')
need('printer/emitcontext.rs', '#[derive(Default)]\npub struct EmitContext {')
w('pub mod printer {\n')
w(path_mod('printer/emitresolver.rs'))
w('''pub use emitresolver::*;

use crate::ast::{Ast, ModifierListId, NodeId, NodeSink, NodeUpdate};

// printer/emitcontext.rs
#[derive(Default)]
pub struct EmitContext {
    pub marker: (),
}

// printer/factory.rs
pub struct NodeFactory<'a, 'c> {
    pub marker: std::marker::PhantomData<(Ast<'a>, &'c mut EmitContext)>,
}

impl NodeSink for NodeFactory<'_, '_> {
    fn new_modifier_list(&mut self, _nodes: &[NodeId]) -> ModifierListId {
        loop {}
    }
}

impl NodeUpdate for NodeFactory<'_, '_> {}

#[allow(unused_variables)]
mod stand_ins {
    use super::*;

    impl EmitContext {
''')
w(stub('printer/emitcontext.rs', 'parse_node', 4))
w('    }\n\n')
w(stub('printer/factory.rs', 'new_node_factory', 0))
w('}\npub use stand_ins::*;\n}\n\n')

# binder
trait = block('binder/referenceresolver.rs', 'pub trait ReferenceResolver<')
hooks = block('binder/referenceresolver.rs', 'pub struct ReferenceResolverHooks<')
impl_body = trait.split('\n', 1)[1].rsplit('}', 1)[0]
impl_body = re.sub(r'\) -> ([^;{]+);', r') -> \1 {\n        loop {}\n    }', impl_body)
if ';' in impl_body:
    sys.exit('binder/referenceresolver.rs: a method of ReferenceResolver that the script does not turn into a stand-in')
w('''pub mod binder {
    use crate::ast::{Ast, NodeId, SymbolFlags, SymbolId};
    use crate::core::{CompilerOptions, Text};
    use crate::diagnostics::MessageId;

    // binder/referenceresolver.rs
''')
w(''.join('    ' + l + '\n' if l else '\n' for l in trait.rstrip('\n').split('\n')))
w('\n')
w(''.join('    ' + l + '\n' if l else '\n' for l in hooks.rstrip('\n').split('\n')))
sig = fn_sig('binder/referenceresolver.rs', 'new_reference_resolver', 0)
w('''
    #[allow(unused_variables)]
    mod stand_ins {
        use super::*;

        struct ReferenceResolverImpl<'a, 'o, H> {
            options: &'o CompilerOptions,
            hooks: ReferenceResolverHooks<'a, H>,
        }

        impl<'a, H> ReferenceResolver<'a, H> for ReferenceResolverImpl<'a, '_, H> {
''')
w(''.join('        ' + l + '\n' if l else '\n' for l in impl_body.strip('\n').split('\n')))
w('        }\n\n')
w(''.join('        ' + l + '\n' for l in sig.split('\n')))
w('''            ReferenceResolverImpl { options, hooks }
        }
    }
    pub use stand_ins::*;
}

''')

# checker
types = 'checker/types.rs'
need(types, '#[derive(Default)]\npub struct Type<\'a> {\n    pub flags: TypeFlags,\n    pub object_flags: ObjectFlags,\n    pub symbol: SymbolId,')
need(types, '#[derive(Default)]\npub struct Signature<\'a> {')
need(types, '    pub declaration: NodeId,\n    pub type_parameters: List<\'a, TypeId>,')
need(types, '    as_literal_type, as_literal_type_mut, Literal, LiteralType<\'a>, literal, "AsLiteralType";')
need(types, '            pub fn $read(&self, t: TypeId) -> &$ty {')
need('checker/links.rs', 'pub type NodeLinkStore<V> = LinkStore<NodeId, V>;')
need('checker/c02_program_checker.rs', 'pub trait Fallback<\'a>: Sized {\n    fn fallback(c: &Checker<\'a>) -> Self;\n}')
need('checker/c02_program_checker.rs', 'impl<\'a, T> Fallback<\'a> for Vec<T> {')
need('checker/c02_program_checker.rs', 'pub trait ListItem<\'a>: Copy + Default + \'a {')
need('checker/c02_program_checker.rs', '        symbol_ids: SymbolId,')
need('checker/c02_program_checker.rs', '        ast: Ast<\'a>,')
need('checker/c02_program_checker.rs', '        compiler_options: &\'a CompilerOptions,')
need('checker/c02_program_checker.rs', '        stack_check: StackCheck = StackCheck::init(),')
need('checker/mod.rs', 'pub use emitresolver::*;')
w('pub mod checker {\n')
w(path_mod('checker/emitresolver.rs'))
w('''pub use emitresolver::*;
pub use stand_ins::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Ast, Id, ModifierFlags, NodeId, OPEN_BIT, SymbolFlags, SymbolId, SymbolTableId};
    use crate::checker::emitresolver::EmitResolverState;
    use crate::core::{CompilerOptions, Link, LinkStore, List, ResolutionMode, Text};
    use crate::diagnostics::MessageId;
    use crate::evaluator;
    use crate::jsnum::PseudoBigInt;
    use crate::printer::SymbolAccessibilityResult;
    use std::borrow::{Borrow, Cow};
    use std::cell::Cell;
    use std::marker::PhantomData;
    use std::ops::{Index, IndexMut};

    // checker/types.rs
''')


def indented(text):
    return ''.join('    ' + l + '\n' if l else '\n' for l in text.rstrip('\n').split('\n'))


w(indented(region(types, 'macro_rules! checker_flags {', 'pub(crate) use checker_flags;')))
w(indented(region(types, 'macro_rules! define_checker_id {', '// The records of one id space')))
w(indented(region(types, 'pub struct Records<I, T> {', '// `s[lo:hi]` of a list that a record keeps')))
for first in ['pub struct MappedSymbolLinks {', 'pub struct AliasSymbolLinks {', 'pub struct ReverseMappedSymbolLinks {',
              'pub struct SymbolNodeLinks {', 'pub struct EnumMemberLinks<', 'pub struct IndexInfo<',
              'pub struct LiteralType<']:
    w(indented(block(types, first, 1)))
w(indented(block(types, 'pub enum LiteralValue<', 1)))
w(indented(block(types, 'checker_flags!(TypeFlags: u32 {')))
w(indented(block(types, 'checker_flags!(ObjectFlags: u32 {')))
w('    // checker/c01_data.rs\n')
w(indented(block('checker/c01_data.rs', 'checker_flags!(ReferenceHint: i32 {')))
w('''
    // checker/types.rs: the members of a type and of a signature that the file reads.
    #[derive(Default)]
    pub struct Type<'a> {
        pub flags: TypeFlags,
        pub object_flags: ObjectFlags,
        pub symbol: SymbolId,
        pub marker: PhantomData<&'a ()>,
    }

    #[derive(Default)]
    pub struct Signature<'a> {
        pub declaration: NodeId,
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

    // checker/c02_program_checker.rs 122 and 226: the bounds of the lists and of the fallbacks.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for SymbolId {}
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
    fallback_default!(bool, NodeId);
    impl<'a, T> Fallback<'a> for Vec<T> {
        fn fallback(_: &Checker<'a>) -> Self {
            Vec::new()
        }
    }

    // checker/c02_program_checker.rs: the fields that the file reads and writes, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: PhantomData<Cell<&'a ()>>,
        pub compiler_options: &'a CompilerOptions,
        pub stack_check: StackCheck,
''')
c02 = '\n'.join(lines_of('checker/c02_program_checker.rs'))
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
        // checker/types.rs: concrete_casts! makes it.
        pub fn as_literal_type(&self, t: TypeId) -> &LiteralType<'a> {
            loop {}
        }

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
with open(os.path.join(WORK, 'emitresolver-probe.rs'), 'w') as f:
    f.write(''.join(out))
print('emitresolver-probe.rs: %d lines, %d callees written by hand' % (''.join(out).count('\n'), missing))
