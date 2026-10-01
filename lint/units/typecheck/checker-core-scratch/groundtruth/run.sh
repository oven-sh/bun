#!/bin/bash
# Writes the ground truth files of out/ again with the probe that build.sh made.
# usage: run.sh [work dir, default /tmp/k3a/gt] [out dir, default <work dir>/out]
set -e
W=${1:-/tmp/k3a/gt}
O=${2:-$W/out}
HERE=$(cd "$(dirname "$0")" && pwd)
I=$HERE/inputs
L=/workspace/ref/typescript-go/internal/bundled/libs
LIB="lib.es5.d.ts=$L/lib.es5.d.ts lib.decorators.d.ts=$L/lib.decorators.d.ts lib.decorators.legacy.d.ts=$L/lib.decorators.legacy.d.ts"
mkdir -p "$O"
"$W/initprobe" min.ts=$I/min.ts > "$O/out.strict.nolib.txt"
"$W/initprobe" -nostrict min.ts=$I/min.ts > "$O/out.nostrict.nolib.txt"
"$W/initprobe" -exact min.ts=$I/min.ts > "$O/out.exact.nolib.txt"
"$W/initprobe" $LIB min.ts=$I/min.ts > "$O/out.strict.es5.txt"
"$W/initprobe" -nostrict $LIB min.ts=$I/min.ts > "$O/out.nostrict.es5.txt"
"$W/initprobe" -max 0 $LIB a.ts=$I/a.ts b.ts=$I/b.ts m1.ts=$I/m1.ts m2.ts=$I/m2.ts > "$O/out.merge.es5.txt"
A=$I/alias
"$W/initprobe" -aliases lib1.ts=$A/lib1.ts lib2.ts=$A/lib2.ts lib3.ts=$A/lib3.ts eq.ts=$A/eq.ts cyc1.ts=$A/cyc1.ts cyc2.ts=$A/cyc2.ts user.ts=$A/user.ts > "$O/out.aliases.txt"
echo "wrote $O"
