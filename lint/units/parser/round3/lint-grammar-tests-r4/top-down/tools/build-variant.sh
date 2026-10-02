#!/bin/sh
# Builds the test binary of the scratch copy of bun_js_parser (/tmp/r4td/root) with the arguments that cargo gave rustc for the
# test target of the crate (captured in /tmp/r4td/rustc-js-parser-test.args), and one variant of the generated file in place.
# usage: /workspace/tools/lk sh build-variant.sh <variant.rs> <tag>     output: /tmp/r4td/root/out/<tag>/bun_js_parser-*
set -e
S=${S:-/tmp/r4td/root}
VARIANT=$1
TAG=$2
cp "$VARIANT" "$S/src/js_parser/parse/grammar_rows_tests.rs"
rustfmt --edition 2024 "$S/src/js_parser/parse/grammar_rows_tests.rs"
mkdir -p "$S/out/$TAG"
rm -f "$S/out/$TAG"/bun_js_parser-*
# The arguments of cargo, with the scratch source and output, human errors, and no dep-info.
python3 - "$S" "$TAG" <<'PY' > "$S/out/$TAG/args"
import sys
S, TAG = sys.argv[1], sys.argv[2]
args = open('/tmp/r4td/rustc-js-parser-test.args').read().split('\n')
if args and args[-1] == '': args.pop()
out = []
i = 1
while i < len(args):
    a = args[i]
    if a == 'src/js_parser/lib.rs': a = S + '/src/js_parser/lib.rs'
    elif a.startswith('--error-format=') or a.startswith('--json='): i += 1; continue
    elif a.startswith('--emit='): a = '--emit=link'
    elif a == '--out-dir': out.append(a); out.append(S + '/out/' + TAG); i += 2; continue
    elif a == 'debuginfo=2': a = 'debuginfo=0'
    elif a == 'split-debuginfo=unpacked': out.pop(); i += 1; continue
    out.append(a); i += 1
print('\n'.join(out))
PY
cd /workspace/bun
export CARGO_CRATE_NAME=bun_js_parser CARGO_MANIFEST_DIR=/workspace/bun/src/js_parser CARGO_PKG_NAME=bun_js_parser CARGO_PKG_VERSION=0.0.0 CARGO_PRIMARY_PACKAGE=1
tr '\n' '\0' < "$S/out/$TAG/args" | xargs -0 /root/.rustup/toolchains/nightly-2026-09-15-x86_64-unknown-linux-gnu/bin/rustc -C codegen-units=16 ${CAP:+--cap-lints} ${CAP:+warn}
ls -la "$S/out/$TAG"/bun_js_parser-* | head -3
