# Copies the diagnostics block (../../diagnostics-scratch/crate) into crate/src with the changes that the merged data model asks of it.
# Every change is one entry below, so this file is the list of what the diagnostics block adapts.
# usage: python3 import_diagnostics.py <crate/src> [--check]
import os, re, subprocess, sys, tempfile

SRC = '/workspace/notes/lint/units/typecheck/diagnostics-scratch/crate/'
# (source file, target file below crate/src)
FILES = [
    ('diagnostics/mod.rs', 'diagnostics/mod.rs'),
    ('diagnostics/diagnostics_generated.rs', 'diagnostics/diagnostics_generated.rs'),
    ('diagnostics/tests.rs', 'diagnostics/tests.rs'),
    ('ast/diagnostic.rs', 'ast_diagnostic.rs'),
    ('compiler/program.rs', 'compiler_program.rs'),
    ('diagnosticwriter/mod.rs', 'diagnosticwriter.rs'),
    ('core/mod.rs', 'tscore/core_text.rs'),
    ('tests.rs', 'diagnostics_tests.rs'),
]
# 1. Module paths of the merged crate. ids, the record store, the sort and TextRange are the node table's.
PATHS = [
    ('crate::arena::Arena', 'crate::tscore::records::Records'),
    ('Arena<DiagnosticId, Diagnostic>', 'Records<DiagnosticId, Diagnostic>'),
    ('Arena::new()', 'Records::new()'),
    ('crate::ids::', 'crate::tscore::ids::'),
    ('crate::slices::', 'crate::tscore::slices::'),
    ('crate::ast::diagnostic::', 'crate::ast_diagnostic::'),
    ('crate::compiler::program::', 'crate::compiler_program::'),
    ('use crate::core::TextRange;', 'use crate::tscore::text::TextRange;'),
    ('use crate::core::{TextRange, compute_ecma_line_starts};', 'use crate::tscore::core_text::compute_ecma_line_starts;\nuse crate::tscore::text::TextRange;'),
    ('crate::core::', 'crate::tscore::core_text::'),
]

def message_names():
    text = open(SRC + 'diagnostics/diagnostics_generated.rs').read()
    return re.findall(r'^\s*\((\w+), \d+,', text, re.M)

def rustfmt(text):
    fd, path = tempfile.mkstemp(suffix='.rs')
    os.write(fd, text.encode()); os.close(fd)
    subprocess.run(['rustfmt', '--edition', '2024', '--config', 'skip_children=true', path], check=True)
    out = open(path).read(); os.unlink(path)
    return out

def transform(source, text, names):
    for a, b in PATHS:
        text = text.replace(a, b)
    # 2. The constants of the messages are upper case: no lint is switched off for them. Upper case keeps the 2,206 names distinct.
    # A string or character literal is left as it is: twelve names are also words of message texts.
    pattern = re.compile(r"'(?:\\.|[^'\\])'" + r'|"(?:\\.|[^"\\])*"|\b(' + '|'.join(sorted(names, key=len, reverse=True)) + r')\b', re.S)
    text = pattern.sub(lambda m: m.group(1).upper() if m.group(1) else m.group(0), text)
    if source == 'diagnostics/mod.rs':
        old = '#[allow(non_upper_case_globals)]\nmod diagnostics_generated;'
        assert old in text
        text = text.replace(old, 'mod diagnostics_generated;')
    if source == 'core/mod.rs':
        # 3. One TextRange: the node table's, with public fields, the upstream accessor names and Go's zero value as the default.
        start = text.index('#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]\npub struct TextRange')
        end = text.index('// utf8.DecodeRune')
        text = text[:start] + text[end:]
        text = text.replace('// Port of the parts of internal/core that diagnostics use: text.go and the line helpers of core.go.\npub type TextPos = i32;',
                            '// Port of the line helpers of internal/core/core.go that diagnostics use. TextRange is in text.rs.\npub type TextPos = i32;')
    if source == 'ast/diagnostic.rs':
        # 5. The record store has a default, so the store of the diagnostics derives its own.
        start = text.index('impl Default for DiagnosticStore {')
        end = text.index('impl core::ops::Index<DiagnosticId> for DiagnosticStore')
        text = text[:start] + text[end:]
        old = 'pub struct DiagnosticStore {'
        assert old in text
        text = text.replace(old, '#[derive(Default)]\n' + old, 1)
        # 4. An argument has a default, so that a list of arguments can be an arena list (the error chain of a relater).
        old = 'impl<\'a> From<&\'a [u8]> for Arg<\'a> {'
        assert old in text
        text = text.replace(old, 'impl Default for Arg<\'_> {\n    fn default() -> Self {\n        Arg::Str(b"")\n    }\n}\n\n' + old, 1)
    return rustfmt(text)

def main():
    out_dir = sys.argv[1]
    names = message_names()
    assert len(names) == 2206 and len({n.upper() for n in names}) == 2206
    ok = True
    for source, target in FILES:
        text = transform(source, open(SRC + source).read(), names)
        path = os.path.join(out_dir, target)
        if '--check' in sys.argv:
            if not os.path.exists(path) or open(path).read() != text:
                print('differs:', target); ok = False
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, 'w').write(text)
    print('diagnostics block:', len(FILES), 'files,', len(names), 'messages,', 'no diff' if ok else 'DIFFERS')
    sys.exit(0 if ok else 1)

main()
