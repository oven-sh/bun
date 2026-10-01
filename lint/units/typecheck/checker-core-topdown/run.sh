#!/bin/sh
# Rebuilds data/codes_by_layer.txt and data/recursion.txt and checks that rust/ compiles with the conventions scratch.
# The tables of ../checker-core-scratch/data come from the same analysis: this directory adds the model and the plans.
# usage: run.sh      works in /tmp/tcres
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/tcres
mkdir -p "$W/anal" "$W/outline" "$W/py" "$W/rs"
cp "$HERE"/tools/goanal/* "$W/anal/"
cp "$HERE"/tools/outline/* "$W/outline/"
cp "$HERE"/tools/py/*.py "$W/py/"
export GOTOOLCHAIN=local
(cd "$W/outline" && go build -o outline . && ./outline /workspace/ref/typescript-go/internal/checker/checker.go > "$W/checker_outline.tsv")
(cd "$W/anal" && go build -o anal . && cd /tmp && "$W/anal/anal" "$W/fns.json" checker binder)
(cd "$W/py" && python3 diagcodes.py detail | awk '/^== [A-Z-]+$/{p=1} p' > "$W/codes_by_layer.txt" && python3 scc.py > "$W/recursion.txt")
cmp "$W/codes_by_layer.txt" "$HERE/data/codes_by_layer.txt"
cmp "$W/recursion.txt" "$HERE/data/recursion.txt"
C=$HERE/../conventions-scratch/rust
cp "$C"/*.rs "$W/rs/"
{ cat "$HERE/rust/types.rs"; grep -v '^use crate::\|^// Second half\|^// Append to' "$HERE/rust/types2.rs"; } > "$W/rs/types.rs"
cp "$HERE/rust/mapper_map.rs" "$W/rs/mapper_map.rs"
python3 - "$W/rs" <<'PY'
import sys
d = sys.argv[1]
s = open(d + '/fn3_instantiate.rs').read()
a = s.index('    // m.Map(t)'); b = s.index('    pub fn report_unreliable_worker')
s = (s[:a] + s[b:]).replace('use crate::types::{FunctionMapper, TypeMapper};\n', '')
open(d + '/fn3_instantiate.rs', 'w').write(s)
c = open(d + '/checker.rs').read().replace('Arena<ConditionalRootId, ConditionalRoot>', "Arena<ConditionalRootId, ConditionalRoot<'a>>")
open(d + '/checker.rs', 'w').write(c)
i = open(d + '/ids.rs').read().replace('    MessageId,\n', '    MessageId,\n    CompositeSignatureId,\n    InferenceContextId,\n')
open(d + '/ids.rs', 'w').write(i)
v = open(d + '/conv.rs').read().replace('pub mod keys;', 'pub mod keys;\npub mod mapper_map;')
open(d + '/conv.rs', 'w').write(v)
PY
(cd "$W/rs" && rustc --edition 2024 --crate-type lib -o libconv.rlib conv.rs && rustc --edition 2024 --test -o conv_tests conv.rs && ./conv_tests && rustfmt --edition 2024 --check types.rs mapper_map.rs)
echo "topdown scratch ok"
