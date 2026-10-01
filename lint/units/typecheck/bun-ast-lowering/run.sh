#!/bin/sh
# Regenerates the typescript-go trees of probe/src (the oracle a lowered table must print equal to).
# Needs /tmp/rr/dumpast: build it with ../ts-dump-and-test-importer/groundtruth/build.sh (Go 1.26 from source).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/probe/src"
ARGS=$(ls | awk -v d="$HERE/probe/src" '{print $0"="d"/"$0}')
/tmp/rr/dumpast "$HERE/probe/tsgo" $ARGS
/tmp/rr/dumpast -nojsdoc "$HERE/probe/tsgo-nojsdoc" $ARGS
echo "wrote $(ls "$HERE/probe/tsgo" | wc -l) trees"
