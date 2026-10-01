#!/bin/sh
# Runs the reference on the inputs of this directory and compares with the *.out.txt files next to them.
# Needs /tmp/cdg/gt/declprobe (../../bottom-up/groundtruth/build.sh) and, for pien, the Go module of /tmp/ctl/gt/mod:
#   mkdir -p /tmp/ctl/gt/mod/cmd/pienprobe && cp pienprobe_main.go.txt /tmp/ctl/gt/mod/cmd/pienprobe/main.go
#   (cd /tmp/ctl/gt/mod && GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOCACHE=/tmp/ctl/gt/gocache PATH=/tmp/rr/go126/bin:$PATH go build -o /tmp/cdg-td/gt/pienprobe ./cmd/pienprobe)
# usage: run.sh [work dir, default /tmp/cdg-td/gt]
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-/tmp/cdg-td/gt}
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
mkdir -p "$W/res" "$W/covscratch"
one() {
  name=$1; file=$2; shift 2
  (cd "$HERE" && GOCOVERDIR="$W/covscratch" /tmp/cdg/gt/declprobe "$@" lib.es5.d.ts=$LIB/es5.d.ts $file=$file) > "$W/res/$name.out.txt" 2>&1
  cmp -s "$W/res/$name.out.txt" "$HERE/$name.out.txt" || echo "differs: $name"
}
one expando expando.ts -strict
one tsjsdoc tsjsdoc.ts -strict -sugg -o noUnusedLocals=true
one tlamod tlamod.ts -strict -o module=#1
one tlamod2 tlamod.ts -strict -o module=#99 -o target=#9
if [ -x "$W/pienprobe" ]; then
  "$W/pienprobe" < "$HERE/pien.txt" > "$W/res/pien.out.txt"
  cmp -s "$W/res/pien.out.txt" "$HERE/pien.out.txt" || echo "differs: pien"
fi
echo "probes done"
