#!/bin/sh
# Rebuilds the ground truth of this directory: typescript-go's real command line path on min.ts, the order of the
# program files, and the functions that the run enters.
# Needs: Go 1.26 in /tmp/rr/go126 and the five modules of /tmp/rr/deps (see ../ts-dump-and-test-importer/groundtruth/build.sh),
# network access to github.com for golang.org/x/sys v0.46.0, /workspace/ref/typescript-go at 89d5d5b.
# usage: run.sh      work directory /tmp/e2e; run the build step under /workspace/tools/lk
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/e2e
REF=/workspace/ref/typescript-go
mkdir -p "$W/deps" "$W/mod/cmd/k4real" "$W/gocache" "$W/run1" "$W/cov"
if [ ! -d "$W/deps/sys" ]; then
  curl -sSL -o "$W/deps/sys.tgz" https://github.com/golang/sys/archive/refs/tags/v0.46.0.tar.gz
  mkdir -p "$W/deps/sys" && tar -xzf "$W/deps/sys.tgz" -C "$W/deps/sys" --strip-components=1
fi
rm -rf "$W/mod/internal" && cp -r "$REF/internal" "$W/mod/internal"
find "$W/mod/internal" -name '*_test.go' -delete
# Packages outside the import closure of internal/execute that need modules which are not on this machine.
for p in testutil testrunner fourslash project api; do rm -rf "$W/mod/internal/$p"; done
# internal/format imports ls/lsutil, which imports lsp/lsproto: keep those two, drop the rest of ls and lsp.
find "$W/mod/internal/ls" -mindepth 1 -maxdepth 1 ! -name lsutil -exec rm -rf {} +
find "$W/mod/internal/lsp" -mindepth 1 -maxdepth 1 ! -name lsproto -exec rm -rf {} +
cp "$HERE/groundtruth/k4real_main.go.txt" "$W/mod/cmd/k4real/main.go"
cp "$HERE/groundtruth/go.mod.txt" "$W/mod/go.mod"
sh "$HERE/groundtruth/build.sh"

cd "$W/run1" && printf 'const x: number = "s";\n' > min.ts
"$W/k4real" min.ts --noEmit || echo "exit code $?"
"$W/k4real" min.ts --noEmit --listFiles | grep '^bundled' | sed 's#bundled:///libs/##' | cmp - "$HERE/vectors/program-order/target-default.txt"
# A: defaults of the command line (lib files are checked). B: defaults of the test harness. C: B with emit. D: B with --lib es5.
GOCOVERDIR="$W/cov/A" sh -c 'mkdir -p $GOCOVERDIR; exec "$0" "$@"' "$W/k4real.cov" min.ts --noEmit --singleThreaded || true
GOCOVERDIR="$W/cov/B" sh -c 'mkdir -p $GOCOVERDIR; exec "$0" "$@"' "$W/k4real.cov" min.ts --noEmit --singleThreaded --skipDefaultLibCheck --noErrorTruncation || true
GOCOVERDIR="$W/cov/C" sh -c 'mkdir -p $GOCOVERDIR; exec "$0" "$@"' "$W/k4real.cov" min.ts --singleThreaded --skipDefaultLibCheck --noErrorTruncation || true
GOCOVERDIR="$W/cov/D" sh -c 'mkdir -p $GOCOVERDIR; exec "$0" "$@"' "$W/k4real.cov" min.ts --noEmit --singleThreaded --skipDefaultLibCheck --noErrorTruncation --lib es5 || true
export GOTOOLCHAIN=local GOPROXY=off GOFLAGS=-mod=mod GOCACHE="$W/gocache" PATH=/tmp/rr/go126/bin:$PATH
for v in A B C D; do (cd "$W/mod" && go tool covdata func -i="$W/cov/$v" > "$W/cov/$v.func.txt"); done
cp "$HERE/py/an.py" "$W/cov/an.py"
(cd "$W/cov" && python3 an.py B && python3 an.py A && python3 an.py A B && python3 an.py C B)
echo "lists: $W/cov/B.entered.tsv (harness defaults) $W/cov/A.entered.tsv (command line defaults)"
# The census of the run instances (needs the prototypes of ../../conformance): bun probe/census.ts
# The lib closures of the model against the binary: python3 py/closure.py lib.es2025.full.d.ts lib.es6.d.ts
