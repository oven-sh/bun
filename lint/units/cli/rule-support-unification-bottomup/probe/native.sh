#!/bin/sh
# Compiles src/jsc/bindings/highway_strings.cpp of the worktree, with the flags of its debug build, to <out>/../highway_strings.o.
# usage: /workspace/tools/lk sh native.sh [worktree] [out dir]
WT=${1:-/workspace/wt/cli}
OUT=${2:-/tmp/rsu/out}
mkdir -p "$OUT"
python3 - "$WT" "$OUT" <<'PY' > "$OUT/../cc_hwy.sh"
import json, sys
wt, out = sys.argv[1], sys.argv[2]
for e in json.load(open(f"{wt}/build/debug/compile_commands.json")):
    if e["file"].endswith("highway_json.cpp"):
        cmd = e.get("command") or " ".join(e["arguments"])
        cmd = cmd.replace(f"{wt}/src/jsc/bindings/highway_json.cpp", f"{wt}/src/jsc/bindings/highway_strings.cpp")
        cmd = cmd.replace(f"{wt}/build/debug/obj/src/jsc/bindings/highway_json.cpp.o", f"{out}/../highway_strings.o")
        print(f"cd {wt}/build/debug && " + cmd.replace("-fdiagnostics-color=always", ""))
        break
PY
sh "$OUT/../cc_hwy.sh"
