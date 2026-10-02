# Makes ast/diagnostic.rs of 644e7f1b94 from the file of d0230a94c6 and the texts of the round-1 contract: every difference from the contract is one step below.
# usage: git -C /workspace/wt/typecheck show d0230a94c6:src/typecheck/ast/diagnostic.rs > /tmp/diagnostic-base.rs
#        python3 diagnostic-assemble.py /tmp/diagnostic-base.rs /tmp/diagnostic-new.rs && rustfmt --edition 2024 /tmp/diagnostic-new.rs
#        cmp /tmp/diagnostic-new.rs /workspace/wt/typecheck/src/typecheck/ast/diagnostic.rs   (rustfmt rewraps one call of lookup)
import sys

CONTRACT = '/workspace/notes/lint/units/typecheck/checker-data-model-contract/bottom-up/crate/src/'


def replace_once(text, old, new):
    assert text.count(old) == 1, (text.count(old), old)
    return text.replace(old, new)


def main():
    base = open(sys.argv[1]).read()
    contract = open(CONTRACT + 'ast_diagnostic.rs').read().split('\n')
    slices = open(CONTRACT + 'tscore/slices.rs').read()

    # The head comment, the imports and the trait of the contract's lines 10 to 16.
    trait = '\n'.join(contract[9:16])
    assert trait.startswith('// What the collection, the comparison and the writers read from a source file.'), trait
    assert trait.endswith('}'), trait
    base = replace_once(
        base,
        '// internal/ast/diagnostic.go: a diagnostic, the arguments of its message, and the store of the diagnostics that one parser, binder or checker makes.\n'
        'use crate::ast::ids::{DiagnosticId, NodeId, OPEN_BIT};\n'
        'use crate::core::{TextRange, undefined_text_range};\n'
        'use crate::diagnostics::{self, Category, Locale, MessageId};\n',
        '// internal/ast/diagnostic.go: a diagnostic, the arguments of its message, the store of the diagnostics that one parser, binder or checker makes, their comparison, and the collection that a checker keeps them in.\n'
        'use crate::ast::ids::{DiagnosticId, NodeId, OPEN_BIT};\n'
        'use crate::core::{ResolutionMode, TextRange, undefined_text_range};\n'
        'use crate::diagnostics::{self, Category, Locale, MessageId};\n'
        'use crate::stringutil::util::strings;\n'
        'use std::collections::BTreeMap as MapImpl;\n'
        '\n' + trait + '\n',
    )

    # diagnostic.go 15-30.
    base = replace_once(
        base,
        '// ast.Diagnostic: the file is the root of a source file, and a chain or a related diagnostic is an id of the same store.\n',
        '// RepopulateDiagnosticKind indicates the kind of repopulation for a diagnostic chain entry.\n'
        '#[repr(transparent)]\n'
        '#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]\n'
        'pub struct RepopulateDiagnosticKind(pub i32);\n'
        '\n'
        'impl RepopulateDiagnosticKind {\n'
        '    pub const MODE_MISMATCH: Self = Self(1);\n'
        '    pub const MODULE_NOT_FOUND: Self = Self(2);\n'
        '}\n'
        '\n'
        '// RepopulateDiagnosticInfo stores information needed to recompute a diagnostic chain entry during incremental builds when the program state may have changed.\n'
        '#[derive(Clone, PartialEq, Eq, Default, Debug)]\n'
        'pub struct RepopulateDiagnosticInfo {\n'
        '    pub kind: RepopulateDiagnosticKind,\n'
        '    pub module_reference: Vec<u8>,\n'
        '    pub mode: ResolutionMode,\n'
        '    pub package_name: Vec<u8>,\n'
        '}\n'
        '\n'
        '// ast.Diagnostic: the file is the root of a source file, and a chain or a related diagnostic is an id of the same store.\n',
    )

    # diagnostic.go 55, 74 and 80.
    base = replace_once(
        base,
        '    skipped_on_no_emit: bool,\n}\n',
        '    skipped_on_no_emit: bool,\n    repopulate_info: Option<Box<RepopulateDiagnosticInfo>>,\n}\n',
    )
    base = replace_once(
        base,
        '    pub fn skipped_on_no_emit(&self) -> bool {\n        self.skipped_on_no_emit\n    }\n',
        '    pub fn skipped_on_no_emit(&self) -> bool {\n        self.skipped_on_no_emit\n    }\n'
        '    pub fn repopulate_info(&self) -> Option<&RepopulateDiagnosticInfo> {\n        self.repopulate_info.as_deref()\n    }\n',
    )
    base = replace_once(
        base,
        '    pub fn set_skipped_on_no_emit(&mut self) {\n        self.skipped_on_no_emit = true;\n    }\n',
        '    pub fn set_skipped_on_no_emit(&mut self) {\n        self.skipped_on_no_emit = true;\n    }\n'
        '    pub fn set_repopulate_info(&mut self, info: RepopulateDiagnosticInfo) {\n        self.repopulate_info = Some(Box::new(info));\n    }\n',
    )

    # The comparisons and the collection: the contract's lines 337 to 739.
    assert contract[336] == 'const MAX_NESTING: u32 = 200;', contract[336]
    assert contract[338] == '// strings.Compare' and contract[345] == '}' and contract[346] == '', contract[338:347]
    assert contract[738] == '}' and contract[739] == '' and len(contract) == 740, (len(contract), contract[738:])
    tail = '\n'.join(contract[336:338] + contract[347:739]) + '\n'
    assert 'fn compare_strings' not in tail
    assert tail.count('compare_strings(') == 4, tail.count('compare_strings(')
    tail = tail.replace('compare_strings(', 'strings::compare(')
    for name, count in (('binary_search_func', 1), ('sort_stable_func', 2), ('sort_func', 1)):
        assert tail.count(name + '(') == count, (name, tail.count(name + '('))
        tail = tail.replace(name + '(', 'slices::' + name + '(')
    tail = replace_once(
        tail,
        'const MAX_NESTING: u32 = 200;\n',
        '// How deep a message chain or related information is followed: upstream recurses without a bound.\n'
        'const MAX_NESTING: u32 = 200;\n',
    )
    tail = replace_once(
        tail,
        'pub struct Diagnostics<\'a, F: ?Sized> {\n',
        '// The diagnostics of one store together with the files that they name: what upstream reads through the pointers of a diagnostic.\n'
        'pub struct Diagnostics<\'a, F: ?Sized> {\n',
    )
    # diagnostic.go 399-401.
    tail = replace_once(
        tail,
        '            return MessageIdentity::Text(&diagnostic.message_text);\n'
        '        }\n'
        '        MessageIdentity::Owned(diagnostic.message_key())\n',
        '            return MessageIdentity::Text(&diagnostic.message_text);\n'
        '        }\n'
        '        // message.String() of a message made by NewAdHocMessage: its text is the message text of the diagnostic.\n'
        '        if !diagnostic.message.is_nil() && diagnostic.code == -1 {\n'
        '            return MessageIdentity::Text(&diagnostic.message_text);\n'
        '        }\n'
        '        MessageIdentity::Owned(diagnostic.message_key())\n',
    )
    tail = replace_once(
        tail,
        '#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]\nstruct DiagnosticLocationKey {\n',
        '// diagnosticLocationKey: the root of the file stands for its path.\n'
        '#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]\nstruct DiagnosticLocationKey {\n',
    )
    tail = replace_once(
        tail,
        '#[derive(Default)]\npub struct DiagnosticsCollection {\n    count: usize,\n    file_order: Vec<NodeId>,\n',
        '// ast.DiagnosticsCollection without its mutex: a collection belongs to one checker, and its diagnostics are ids of the store of the view that each method takes.\n'
        '#[derive(Default)]\npub struct DiagnosticsCollection {\n    count: usize,\n'
        '    // The files in the order of their first diagnostic: get_diagnostics walks them in it, where upstream ranges over a map.\n'
        '    file_order: Vec<NodeId>,\n',
    )
    tail = replace_once(
        tail,
        '        if diagnostic.is_nil() {\n            return diagnostic;\n        }\n        let key = get_diagnostic_location_key(&d.store[diagnostic]);\n',
        '        // A nil diagnostic is not collected: upstream dereferences it.\n'
        '        if diagnostic.is_nil() {\n            return diagnostic;\n        }\n        let key = get_diagnostic_location_key(&d.store[diagnostic]);\n',
    )

    # Go's sorting: the contract's tscore/slices.rs as a private module of the file.
    head = '// Go\'s `slices` sorting, statement for statement, so that the sequence of comparator calls is upstream\'s.\n'
    assert slices.startswith(head), slices[:200]
    body = slices[len(head):]
    assert body.count('\npub fn ') == 2 and body.startswith('pub fn binary_search_func'), body.count('\npub fn ')
    body = body.replace('\npub fn ', '\npub(super) fn ')
    body = 'pub(super) fn ' + body[len('pub fn '):]
    assert 'pub fn' not in body and body.count('pub(super) fn ') == 3
    indented = ''.join(('    ' + line if line.strip() else line) for line in body.splitlines(True))
    module = head + 'mod slices {\n' + indented + '}\n'

    assert base.endswith('}\n')
    out = base + '\n' + tail + '\n' + module
    open(sys.argv[2], 'w').write(out)


main()
