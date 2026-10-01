#!/bin/sh
# Rebuilds the measured use lists of the leaf packages (what checker, binder, evaluator, printer, nodebuilder,
# pseudochecker and diagnosticwriter reach in ast, core, collections, stringutil, tspath, scanner, jsnum, debug).
# Go 1.24 is enough: the packages are type-checked from source with stand-ins for the third-party imports.
# usage: run.sh [out dir, default /tmp/leafuse]     then: LEAF_OUT=<out> python3 py/order.py ast/utilities.go all
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-/tmp/leafuse}
mkdir -p "$OUT"
export GOTOOLCHAIN=local
(cd "$HERE/goanal" && go build -o "$OUT/leafuse" .)
(cd "$HERE/goanal/decls" && go build -o "$OUT/decls" .)
T=ast,core,collections,stringutil,tspath,scanner,jsnum,evaluator,debug,diagnostics,binder
(cd /tmp && "$OUT/leafuse" checker,binder,evaluator "$T" "$OUT/use_cbe.json")
(cd /tmp && "$OUT/leafuse" binder "$T" "$OUT/use_binder.json")
(cd /tmp && "$OUT/leafuse" checker,binder,evaluator,printer,nodebuilder,pseudochecker,diagnosticwriter "$T,printer,nodebuilder,pseudochecker,diagnosticwriter" "$OUT/use_dw.json")
(cd /tmp && "$OUT/decls" "$OUT/decls.json" ast core collections stringutil tspath scanner jsnum evaluator debug diagnostics binder)
echo "wrote $OUT/use_cbe.json use_binder.json use_dw.json use_dw.json.edges.json decls.json"
