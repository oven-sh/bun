#!/bin/sh
# The sources of the base (main at f4d755a9cf) that newlines.py, outside.py and cglinediff.py read: /tmp/proofcost/base-src.
# usage: mkbase.sh [commit] [dir]
C=${1:-f4d755a9cf}; D=${2:-/tmp/proofcost/base-src}
mkdir -p "$D" && git -C /workspace/bun archive "$C" src/js_parser src/ast src/bun_alloc src/bun_core src/collections src/options_types src/paths src/sourcemap src/ptr src/wyhash src/js_printer src/highway | tar -x -C "$D" && echo "$D: $C"
