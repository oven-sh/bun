#!/bin/sh
# Research probe: runs the snapshot build on min.ts and converts the counters of each phase into a function list.
# usage: sh snap.sh <run name> <tsgo options...>
W=/tmp/k4drv
O=/tmp/oe-research
export PATH="$O/go126/bin:$PATH" GOROOT="$O/go126" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$O/gocache" GOMODCACHE="$O/gomodcache"
name=$1; shift
rm -rf "$W/snap/$name"; mkdir -p "$W/snap/$name/run" "$W/snap/$name/cov/9-report"
cp "$W/w1/min.ts" "$W/snap/$name/run/min.ts"
(cd "$W/snap/$name/run" && K4SNAP_DIR="$W/snap/$name/cov" GOCOVERDIR="$W/snap/$name/cov/9-report" "$W/tsgo-snap" "$@" min.ts > out.txt 2> err.txt; echo "exit=$?" > exit.txt)
echo "== $name: $* -> $(cat "$W/snap/$name/run/exit.txt") $(head -1 "$W/snap/$name/run/out.txt")"
for d in "$W/snap/$name/cov"/*/; do
  l=$(basename "$d")
  (cd "$W/tsgo2" && go tool covdata textfmt -i="$d" -o "$W/snap/$name/$l.prof" 2>/dev/null && go tool cover -func="$W/snap/$name/$l.prof" > "$W/snap/$name/$l.func.txt" 2>/dev/null)
  echo "  $l $(awk '$NF != "0.0%" && $1 != "total:"' "$W/snap/$name/$l.func.txt" | wc -l)"
done
