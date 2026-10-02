#!/bin/sh
# clippy-driver over the test target of the scratch copy, with the arguments of cargo (the lint levels of the workspace) and clippy.toml of the repository.
# usage: /workspace/tools/lk sh clippy-variant.sh <variant.rs> <tag>       S=<scratch root>
S=${S:-/tmp/r4td/root}
VARIANT=$1
TAG=$2
cp "$VARIANT" "$S/src/js_parser/parse/grammar_rows_tests.rs"
rustfmt --edition 2024 "$S/src/js_parser/parse/grammar_rows_tests.rs"
mkdir -p "$S/out/$TAG-clippy"
python3 - "$S" "$TAG" <<'PY' > "$S/out/$TAG-clippy/args"
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
    elif a.startswith('--emit='): a = '--emit=metadata'
    elif a == '--out-dir': out.append(a); out.append(S + '/out/' + TAG + '-clippy'); i += 2; continue
    elif a == 'debuginfo=2': a = 'debuginfo=0'
    elif a == 'split-debuginfo=unpacked': out.pop(); i += 1; continue
    out.append(a); i += 1
print('\n'.join(out))
PY
cd /workspace/bun
export CARGO_CRATE_NAME=bun_js_parser CARGO_MANIFEST_DIR=/workspace/bun/src/js_parser CARGO_PKG_NAME=bun_js_parser CARGO_PKG_VERSION=0.0.0 CARGO_PRIMARY_PACKAGE=1 CLIPPY_CONF_DIR=/workspace/bun
export LD_LIBRARY_PATH=/root/.rustup/toolchains/nightly-2026-09-15-x86_64-unknown-linux-gnu/lib
tr '\n' '\0' < "$S/out/$TAG-clippy/args" | xargs -0 /root/.rustup/toolchains/nightly-2026-09-15-x86_64-unknown-linux-gnu/bin/clippy-driver
echo "clippy exit=$?"
