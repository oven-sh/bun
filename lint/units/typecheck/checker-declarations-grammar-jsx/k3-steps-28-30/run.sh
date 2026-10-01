#!/bin/sh
# K3 steps 28 to 30 (D-ITER, E-AWAIT, X-JSX, E-DECOR, D-DECOR): checks of the nine files without a build of Bun.
#   1. rustfmt --check of the nine files.
#   2. rustc alone (metadata only) with the deny set of the workspace: the files are mounted in a scratch root beside the real
#      core, collections, stringutil, tspath, jsnum, ast and scanner of src/typecheck and the records of the data model
#      contract (types.rs, c01_data.rs, flags_generated.rs, core_lists.rs). A callee that the tree defines is a stand-in with
#      the signature of the tree; a callee that no file of the tree defines yet is a stand-in of stubs/checker_stub_template.rs.
#   3. clippy-driver with the lint table of the workspace Cargo.toml and the clippy.toml of the repository; only findings
#      in files of the repository count (the stand-ins are full of todo!()).
#   4. with `pien`: parse_isolated_entity_name of jsx.rs against parser.ParseIsolatedEntityName of typescript-go 89d5d5b
#      (needs the Go 1.26 toolchain of /tmp/rr/go126 and the module copy /tmp/rr/parsediag-mod).
# usage: run.sh [work dir, default /tmp/k3-28-30] [pien]
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-/tmp/k3-28-30}
WT=/workspace/wt/typecheck
CK=$WT/src/typecheck/checker
FILES="c11_check_variables_decorators.rs c12_iteration_types.rs c15_calls.rs c17_unary_meta_yield.rs c47_promised_mapped_template.rs c48_contextual_types.rs c49_call_arguments_decorator_signatures.rs c51_type_facts_awaited.rs jsx.rs"
mkdir -p "$W/out"
fmt=0
for f in $FILES; do rustfmt --check --edition 2024 --config skip_children=true "$CK/$f" > /dev/null 2>&1 || { echo "rustfmt: $f differs"; fmt=1; }; done
[ $fmt = 0 ] && echo "1. rustfmt: clean"
rustc --edition 2024 --crate-type rlib --crate-name bun_core -o "$W/out/libbun_core.rlib" "$HERE/ext/bun_core.rs" || exit 1
rustc --edition 2024 --crate-type rlib --crate-name bun_collections -o "$W/out/libbun_collections.rlib" "$HERE/ext/bun_collections.rs" || exit 1
python3 "$HERE/gen/parts.py" "$W" > /dev/null || exit 1
python3 "$HERE/gen/gen.py" "$HERE" "$W" > "$W/out/gen.txt" || exit 1
sed -e "s#@HERE@#$HERE#g" -e "s#@W@#$W#g" "$HERE/lib.rs.in" > "$W/lib.rs"
EXT="-L $W/out --extern bun_core=$W/out/libbun_core.rlib --extern bun_collections=$W/out/libbun_collections.rlib"
DENY="-D warnings -A dead_code -D unused_imports -D unused_variables -D unused_mut -D unused_assignments -D unused_macros -D unreachable_code -D unreachable_patterns"
rustc --edition 2024 --crate-type lib --crate-name k3iter --emit=metadata -o "$W/out/libk3iter.rmeta" $DENY $EXT "$W/lib.rs" > "$W/out/errors.txt" 2>&1
echo "2. rustc: rc=$? errors=$(grep -c '^error' "$W/out/errors.txt") ($(head -1 "$W/out/gen.txt"))"
python3 - "$WT/Cargo.toml" > "$W/out/lintflags.txt" <<'PY'
import sys, tomllib
lints = tomllib.load(open(sys.argv[1], 'rb'))['workspace']['lints']
items = []
for tool in ('rust', 'clippy'):
    for k, v in lints.get(tool, {}).items():
        level = v if isinstance(v, str) else v.get('level')
        prio = 0 if isinstance(v, str) else v.get('priority', 0)
        if k != 'unexpected_cfgs':
            items.append((prio, (k if tool == 'rust' else 'clippy::' + k), level))
items.sort(key=lambda x: x[0])
print(' '.join({'deny': '-D', 'allow': '-A', 'warn': '-W', 'forbid': '-F'}[l] + ' ' + n for _, n, l in items))
PY
sed 's/#!\[allow(clippy::all)\]//' "$W/lib.rs" > "$W/lib_clippy.rs"
CLIPPY_CONF_DIR=$WT clippy-driver --edition 2024 --crate-type lib --crate-name k3iter --emit=metadata -o "$W/out/libk3iter_clippy.rmeta" $(cat "$W/out/lintflags.txt") -A dead_code -A unreachable_pub $EXT "$W/lib_clippy.rs" > "$W/out/clippy.txt" 2>&1
echo "3. clippy: findings in files of the repository or in the two scratch copies: $(grep -A3 '^error\|^warning' "$W/out/clippy.txt" | grep -- '-->' | grep -c "$WT/src\|_part.rs")"
[ "$2" = pien ] || exit 0
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOCACHE="$W/gocache" PATH=/tmp/rr/go126/bin:$PATH
if [ ! -x "$W/out/pien_go" ]; then
  rm -rf "$W/gomod" && cp -r /tmp/rr/parsediag-mod "$W/gomod" && mkdir -p "$W/gomod/cmd/pien" && cp "$HERE/pien/main.go" "$W/gomod/cmd/pien/main.go"
  (cd "$W/gomod" && go build -p 2 -o "$W/out/pien_go" ./cmd/pien) || exit 1
fi
rustc --edition 2024 --crate-type rlib --crate-name k3iter -A warnings -o "$W/out/libk3iter.rlib" $EXT "$W/lib.rs" || exit 1
rustc --edition 2024 -A warnings -o "$W/out/pien_rust" $EXT --extern k3iter="$W/out/libk3iter.rlib" "$HERE/pien/pien_main.rs" || exit 1
python3 "$HERE/pien/inputs.py" > "$W/out/pien_inputs.txt"
"$W/out/pien_go" < "$W/out/pien_inputs.txt" > "$W/out/pien_go.txt"
"$W/out/pien_rust" < "$W/out/pien_inputs.txt" > "$W/out/pien_rust.txt"
cmp "$W/out/pien_go.txt" "$W/out/pien_rust.txt" && echo "4. parse_isolated_entity_name: $(wc -l < "$W/out/pien_rust.txt") inputs identical to the Go reference ($(grep -vc '^nil$' "$W/out/pien_go.txt") with a result)"
