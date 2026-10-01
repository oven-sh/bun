#!/bin/bash
# The goldens of the structural oracle: "checker-state v1" dumps of fixed fixtures after fixed drive steps.
# Each run is one line of runs.txt: name | flags | libs (names below TypeScript/src/lib) | drive steps | fixture files.
# usage: bash state.sh make  [work dir of bootstrap.sh]     writes golden/<name>.state.txt again
#        bash state.sh check [work dir]                     makes them twice in a scratch dir and compares: with each other
#                                                           (a dump must not change from run to run) and with golden/
#        bash state.sh layers [work dir]                    needs <work dir>/tsgoprobe.cover (COVER=1): writes layers.txt, the
#                                                           checker and binder functions that each run enters, by K3 layer
#   PROBE=<binary>   the probe to use (default <work dir>/tsgoprobe)
set -uo pipefail
MODE=${1:-check}
W=${2:-/tmp/oracle-bu}
HERE=$(cd "$(dirname "$0")" && pwd)
P=${PROBE:-$W/tsgoprobe}
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
run() { # <probe> <out dir>
  while IFS='|' read -r name flags libs steps files; do
    name=$(echo $name); [ -z "$name" ] && continue
    case "$name" in \#*) continue;; esac
    args=""
    for l in $libs; do args="$args lib.$l.d.ts=$LIB/$l.d.ts"; done
    for f in $files; do args="$args $f=$f"; done
    drive=""
    steps=$(echo $steps)
    [ -n "$steps" ] && drive="-drive $steps"
    if [ -n "${GOCOVERDIR_BASE:-}" ]; then
      rm -rf "$GOCOVERDIR_BASE/$name" && mkdir -p "$GOCOVERDIR_BASE/$name"
      (cd "$HERE/fixtures" && GOCOVERDIR="$GOCOVERDIR_BASE/$name" "$1" state $flags $drive $args) > "$2/$name.state.txt" 2>&1
    else
      (cd "$HERE/fixtures" && "$1" state $flags $drive $args) > "$2/$name.state.txt" 2>&1
    fi
  done < "$HERE/runs.txt"
}
case "$MODE" in
  make)
    run "$P" "$HERE/golden"
    grep -l '^PANIC\|^UNKNOWNSTEP\|^panic' "$HERE"/golden/*.state.txt && echo "a run panicked: the golden is not usable"
    ls "$HERE/golden" | wc -l
    ;;
  check)
    A=$(mktemp -d); B=$(mktemp -d)
    run "$P" "$A"; run "$P" "$B"
    same=0; changed=0; stale=0
    for f in "$A"/*.state.txt; do
      n=$(basename "$f")
      if cmp -s "$f" "$B/$n"; then same=$((same+1)); else changed=$((changed+1)); echo "  changes from run to run: $n"; fi
      cmp -s "$f" "$HERE/golden/$n" || { stale=$((stale+1)); echo "  differs from golden: $n"; }
    done
    echo "state.golden runs=$((same+changed)) stable=$same unstable=$changed identical-to-golden=$((same+changed-stale)) different=$stale"
    rm -rf "$A" "$B"
    ;;
  layers)
    C=$W/statecov; rm -rf "$C"; mkdir -p "$C/out"
    GOCOVERDIR_BASE="$C/cov" run "$W/tsgoprobe.cover" "$C/out"
    . "$W/env.sh"
    : > "$HERE/layers.txt"
    for d in "$C"/cov/*/; do
      n=$(basename "$d")
      (cd /workspace/ref/typescript-go && go tool covdata func -i="$d") > "$C/$n.func.txt" 2>/dev/null
      { echo "# $n"; python3 "$HERE/../../../end-to-end-k4-k5/py/k3order.py" "$C/$n.func.txt" | grep -v ' fn=   0 '; } >> "$HERE/layers.txt"
    done
    python3 "$HERE/layers.py" "$C"
    ;;
esac
