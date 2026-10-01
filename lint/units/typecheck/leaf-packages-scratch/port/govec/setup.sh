#!/bin/sh
# Copies the leaf packages of typescript-go unchanged into a scratch module (internal/json becomes encoding/json,
# the JSON methods of OrderedMap are cut), so that Go programs can print what upstream's functions answer.
# usage: setup.sh [work dir, default /tmp/leafport/govec]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-$HERE}
R=/workspace/ref/typescript-go/internal
mkdir -p "$W/stringutil" "$W/jsnum" "$W/json" "$W/tspath" "$W/debug" "$W/collections" "$W/core"
printf 'module golden\n\ngo 1.24\n' > "$W/go.mod"
rewrite() { sed 's#github.com/microsoft/typescript-go/internal/#golden/#' "$1" > "$2"; }
for f in "$R"/stringutil/*.go; do case $f in *_test.go|*generate.go) ;; *) cp "$f" "$W/stringutil/";; esac; done
for f in "$R"/jsnum/*.go; do case $f in *_test.go) ;; *) rewrite "$f" "$W/jsnum/$(basename "$f")";; esac; done
for f in path.go extension.go ignoredpaths.go; do rewrite "$R/tspath/$f" "$W/tspath/$f"; done
rewrite "$R/debug/debug.go" "$W/debug/debug.go"
for f in ordered_set.go set.go multimap.go cow.go; do rewrite "$R/collections/$f" "$W/collections/$f"; done
python3 - "$R/collections/ordered_map.go" "$W/collections/ordered_map.go" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
a = s.index("var _ json.MarshalerTo")
b = s.index("func DiffOrderedMaps")
s = s[:a] + s[b:]
for imp in ['\t"encoding"\n', '\t"errors"\n', '\t"reflect"\n', '\t"strconv"\n', '\n\t"github.com/microsoft/typescript-go/internal/json"\n']:
    s = s.replace(imp, "")
open(sys.argv[2], "w").write(s)
PY
for f in core.go compileroptions.go text.go tristate.go tristate_stringer_generated.go pattern.go scriptkind.go scriptkind_stringer_generated.go languagevariant.go languagevariant_stringer_generated.go modulekind_stringer_generated.go scripttarget_stringer_generated.go stack.go arena.go linkstore.go binarysearch.go; do rewrite "$R/core/$f" "$W/core/$f"; done
cat > "$W/json/json.go" <<'GO'
package json

import stdjson "encoding/json"

func Marshal(in any) ([]byte, error) { return stdjson.Marshal(in) }

func MarshalIndent(in any, prefix, indent string) ([]byte, error) {
	return stdjson.MarshalIndent(in, prefix, indent)
}
GO
echo "scratch module at $W"
