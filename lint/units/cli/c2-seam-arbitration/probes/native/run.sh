#!/bin/sh
# The modules of src/lint that need no real bun_ast (diagnostic, diagnosticwriter, program, scanner, source_file, tspath),
# compiled with plain rustc against three stand-in crates, with the tests of tests.rs that print no code frame.
# usage: sh run.sh <directory that holds the src/lint sources> <scratch dir>
set -e
here=$(cd "$(dirname "$0")" && pwd)
lint=$(cd "$1" && pwd)
mkdir -p "$2" && cd "$2"
python3 - "$lint" <<'EOF'
import re, sys
lint = sys.argv[1]
s = open(lint + '/tests.rs').read()
s = s.replace('use crate::code_frame::write_code_frames;\n', '')
s = s.replace('use crate::log::diagnostics_from_msgs;\n', '')
s = s.replace('use bun_ast::{Loc, Log, Range};\n', '')
s = re.sub(r'fn frames\(.*?\n}\n\n', '', s, flags=re.S)
s = re.sub(r'    let mut colored = String::new\(\);\n    write_code_frames.*?\n    assert_eq!\(\n        colored,.*?\n    \);\n', '', s, flags=re.S)
s = re.sub(r'    assert_eq!\(\n        frames\(.*?\n    \);\n', '', s, flags=re.S)
s = s.replace('    assert_eq!(frames(&files, &[]), "");\n', '')
s = re.sub(r'#\[test\]\nfn what_the_parser_logged\(\) \{.*?\n}\n\n', '', s, flags=re.S)
open('tests_native.rs', 'w').write(s)
mods = ['diagnostic', 'diagnosticwriter', 'program', 'scanner', 'source_file', 'tspath']
lib = ''.join('#[path = "%s/%s.rs"]\npub mod %s;\n' % (lint, m, m) for m in mods)
lib += 'pub use diagnostic::{Category, Code, Diagnostic, MessageChain};\npub use source_file::{FileId, Files, SourceFile};\n'
lib += '#[cfg(test)]\n#[path = "%s/tests_native.rs"]\nmod tests;\n' % __import__('os').getcwd()
open('lib_native.rs', 'w').write(lib)
EOF
R="rustup run nightly-2026-09-15 rustc --edition 2024"
$R --crate-type rlib --crate-name bun_core "$here/shim_bun_core.rs"
$R --crate-type rlib --crate-name bun_ast "$here/shim_bun_ast.rs"
$R --crate-type rlib --crate-name bstr "$here/shim_bstr.rs"
$R --test -A warnings -o native_tests lib_native.rs --extern bun_core=libbun_core.rlib --extern bun_ast=libbun_ast.rlib --extern bstr=libbstr.rlib
./native_tests
