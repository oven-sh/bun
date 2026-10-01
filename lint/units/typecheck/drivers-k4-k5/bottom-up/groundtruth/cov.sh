#!/bin/sh
# Research probe: runs the instrumented tsgo on min.ts in five configurations and writes one coverage profile per run.
# usage: sh cov.sh    (after setup.sh)
W=/tmp/k4drv
O=/tmp/oe-research
export PATH="$O/go126/bin:$PATH" GOROOT="$O/go126" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$O/gocache" GOMODCACHE="$O/gomodcache"
run() {
  name=$1; shift
  rm -rf "$W/cov/$name" "$W/run/$name"; mkdir -p "$W/cov/$name" "$W/run/$name"
  cp "$W/w1/min.ts" "$W/run/$name/min.ts"
  (cd "$W/run/$name" && GOCOVERDIR="$W/cov/$name" "$W/tsgo-cover" "$@" min.ts > out.txt 2> err.txt; echo "exit=$?" > exit.txt)
  echo "== $name: $* -> $(cat "$W/run/$name/exit.txt") $(head -c 300 "$W/run/$name/out.txt" | head -3)"
  (cd "$W/tsgo" && go tool covdata textfmt -i="$W/cov/$name" -o "$W/cov/$name.prof")
  (cd "$W/tsgo" && go tool cover -func="$W/cov/$name.prof" > "$W/cov/$name.func.txt")
  wc -l "$W/cov/$name.func.txt"
}
run listonly --noEmit --listFilesOnly
run nocheck --noEmit --noCheck
run skiplib --noEmit --skipDefaultLibCheck
run skiplib1 --noEmit --skipDefaultLibCheck --singleThreaded
run noemit --noEmit
run default
echo COV-DONE
