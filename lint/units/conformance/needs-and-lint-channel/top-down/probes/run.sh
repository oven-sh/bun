#!/usr/bin/env bash
# Recreates the inputs of the probes in a scratch directory and runs them. usage: run.sh [scratch directory]
# Reads the reference clones and the vectors of the earlier research units. Writes nothing outside the scratch directory.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
unit=$(cd -- "$here/../../.." && pwd)
units=$(cd -- "$unit/.." && pwd)
TS=${TS_CLONE:-/workspace/ref/typescript-go/_submodules/TypeScript}
RELEASE=${RELEASE_BUN:-/workspace/bun/build/release/bun}
DEBUG=${DEBUG_BUN:-/workspace/wt/cli/build/debug/bun-debug}
scratch=${1:-$(mktemp -d)}
mkdir -p "$scratch"
cp "$here"/*.ts "$scratch"/
cd "$scratch"
zcat "$unit/enumerator-topdown/vectors/instances.tsv.gz" > inst.tsv
zcat "$unit/instance-materialisation/vectors/split.tsv.gz" > split.tsv
zcat "$units/typecheck/diagnostics-groundtruth/data/msguse.tsv.gz" > msguse.tsv
(cd "$TS/tests/cases" && grep -rl '/\.lib/' conformance compiler) > libcases.txt

echo "== line endings of the case files"
bun eol.ts "$TS" tests/cases/conformance tests/cases/compiler
echo "== directives of the run instances"
bun optfreq.ts | head -8
echo "== instances whose options are within the k most used declared options"
bun optcover.ts
echo "== run instances without a declared compiler option"
bun noopt.ts
echo "== files of the run instances"
bun prog.ts | head -11
bun more.ts
bun single.ts
bun badjson.ts
bun which_missing.ts
bun casedup.ts
echo "== run instances that name /.lib/"
zcat "$unit/enumerator/vectors/instances.tsv.gz" | bun libinst.ts
echo "== baselines that the plain format can rebuild"
bun plainable.ts
bun order37.ts
echo "== baselines with a diagnostic of the parser or the scanner"
bun syntactic.ts
bun syn1.ts
bun synmix.ts
echo "== comment runs and words in what the corpus copies"
bun comments.ts
bun comment_variants.ts
echo "== cost of one process and of the library files (depends on the load of the machine)"
bun spawncost.ts "$RELEASE" 200 1
bun spawncost.ts "$RELEASE" 400 4
[ -x "$DEBUG" ] && bun spawncost.ts "$DEBUG" 12 1
"$RELEASE" libparse.ts 7
[ -x "$DEBUG" ] && BUN_DEBUG_QUIET_LOGS=1 "$DEBUG" libparse.ts 3
echo "scratch directory: $scratch"
