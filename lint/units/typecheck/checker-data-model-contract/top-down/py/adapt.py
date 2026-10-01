# The edits that the files of the node table prototype and of the diagnostics scratch need to live in one package with the checker model.
# Every edit is (file, pattern, replacement, count): count 0 replaces every match and needs at least one. A missing pattern stops the run.
# usage: adapt.py <assembled crate dir>
import re, sys
C = sys.argv[1] + '/src/'
def edit(name, pairs):
    path = C + name
    s = open(path).read()
    for old, new, count in pairs:
        n = s.count(old)
        if n == 0 or (count and n != count):
            sys.exit('%s: pattern found %d times, expected %s: %s' % (name, n, count or 'at least 1', old[:70]))
        s = s.replace(old, new)
    open(path, 'w').write(s)

# 1. tscore: the modules that the checker and the diagnostics add.
edit('tscore/mod.rs', [('pub mod golang;\n', 'pub mod arena;\npub mod compileroptions;\npub mod golang;\npub mod gomore;\n', 1),
                       ('pub mod internal;\n', 'pub mod internal;\npub mod lines;\npub mod slices;\n', 1)])
# 2. ids: the checker defines its id spaces with the same macro; DiagnosticId is an id of internal/ast.
edit('tscore/ids.rs', [('define_id!(\n    NodeId,', 'pub(crate) use define_id;\n\ndefine_id!(\n    DiagnosticId,\n    NodeId,', 1)])
# 3. the slice arena: pools for the lists of the checker, and cells for a list that its maker keeps writing.
edit('tscore/stable.rs', [
    ('    type_ids: crate::tscore::ids::TypeId,\n);',
     '    type_ids: crate::tscore::ids::TypeId,\n    signature_ids: crate::checker::ids::SignatureId,\n    index_info_ids: crate::checker::ids::IndexInfoId,\n'
     '    element_infos: crate::checker::types::TupleElementInfo,\n    variances: crate::checker::flags_generated::VarianceFlags,\n);', 1),
    ('            $($field: Stable<Box<[$item]>>,)*\n            allocated: Cell<usize>,',
     '            $($field: Stable<Box<[$item]>>,)*\n            type_cells: Stable<Box<[Cell<crate::tscore::ids::TypeId>]>>,\n            allocated: Cell<usize>,', 1),
    ('    pub fn allocated_bytes(&self) -> usize {',
     '    // `make([]*Type, n)` that stays writable after others hold it: every element starts as nil.\n'
     '    pub fn alloc_type_cells(&self, len: usize) -> &[Cell<crate::tscore::ids::TypeId>] {\n'
     '        self.allocated.set(self.allocated.get() + len * 4);\n'
     '        let cells: Box<[Cell<crate::tscore::ids::TypeId>]> = (0..len).map(|_| Cell::default()).collect();\n'
     '        match self.type_cells.push(cells) {\n            Some(slice) => slice,\n            None => &[],\n        }\n    }\n'
     '    pub fn allocated_bytes(&self) -> usize {', 1),
])
# 4. ast: the diagnostics of internal/ast join the node table.
edit('ast/mod.rs', [('pub mod builder;\n', 'pub mod builder;\npub mod diagnostic;\n', 1)])
edit('ast/diagnostic.rs', [
    ('use crate::arena::Arena;', 'use crate::tscore::arena::Arena;', 1),
    ('use crate::core::TextRange;', 'use crate::tscore::text::{TextRange, undefined_text_range};', 1),
    ('use crate::ids::{DiagnosticId, NodeId};', 'use crate::tscore::ids::{DiagnosticId, NodeId};', 1),
    ('use crate::slices::', 'use crate::tscore::slices::', 1),
    ('.loc.pos()', '.loc.pos', 0), ('.loc.end()', '.loc.end', 0),
    # Go's zero TextRange is (0, 0); the Default of the node table is the undefined range (-1, -1).
    ('TextRange::default()', 'TextRange::new(0, 0)', 0),
    ('TextRange::undefined()', 'undefined_text_range()', 0),
    # The arena of this package has a Default, so the store derives its own (clippy::derivable_impls).
    ('pub struct DiagnosticStore {', '#[derive(Default)]\npub struct DiagnosticStore {', 1),
    ('impl Default for DiagnosticStore {\n    fn default() -> Self {\n        Self {\n            arena: Arena::new(),\n            faults: Vec::new(),\n            fault_count: 0,\n        }\n    }\n}\n\n', '', 1),
])
edit('compiler/program.rs', [('use crate::ids::DiagnosticId;', 'use crate::tscore::ids::DiagnosticId;', 1),
                             ('use crate::slices::sort_func;', 'use crate::tscore::slices::sort_func;', 1)])
edit('diagnosticwriter/mod.rs', [('use crate::core::utf16_len;', 'use crate::tscore::lines::utf16_len;', 1),
                                 ('use crate::ids::{DiagnosticId, NodeId};', 'use crate::tscore::ids::{DiagnosticId, NodeId};', 1)])
edit('diagnostics_tests.rs', [
    ('use crate::core::{TextRange, compute_ecma_line_starts};',
     'use crate::tscore::lines::compute_ecma_line_starts;\nuse crate::tscore::text::{TextRange, undefined_text_range};', 1),
    ('use crate::ids::{DiagnosticId, NodeId};', 'use crate::tscore::ids::{DiagnosticId, NodeId};', 1),
    ('TextRange::undefined()', 'undefined_text_range()', 0),
    ('crate::slices::', 'crate::tscore::slices::', 0),
])
# 5. lines.rs is core/mod.rs of the diagnostics scratch without its own TextRange: the node table's is the one.
path = C + 'tscore/lines.rs'
s = open(path).read()
a = s.index('#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]\npub struct TextRange {')
b = s.index('// utf8.DecodeRune')
s = s[:a] + s[b:]
s = s.replace('// Port of the parts of internal/core that diagnostics use: text.go and the line helpers of core.go.',
              '// Port of the line helpers of internal/core/core.go that diagnostics use.', 1)
open(path, 'w').write(s)
print('adapted')
