#!/bin/sh
# One bootstrap for every ground-truth probe of the typecheck unit: the pinned reference, the Go toolchain, the
# module dependencies and ONE probe program (probe/, sub-commands listed by `oracle help`).
# The probe is built with `go build -modfile -overlay` inside the reference clone: no file of the clone is written,
# the probe sources and the patched copies of reference files live in the work directory and in probe/.
# Go's own hosts (proxy.golang.org, go.dev) are not reachable from the build machine: everything comes from github.com.
#
# usage: sh bootstrap.sh [plain] [trace] [cover] [check] [tools]      default: plain
#   plain   <work>/bin/oracle         creation records, harness modes (what every golden of replay.sh needs but the traces)
#   trace   <work>/bin/oracle-trace   plain plus the entry record of every checker function and the relater/inference notes
#   cover   <work>/bin/oracle-cover   plain with statement counters (GOCOVERDIR=<dir>, then `go tool covdata`); built in a
#           copy of the imported packages, because the cover tool cannot read overlay files
#   check   type-checks the probe sources from source in seconds (tcheck), no build
#   tools   only the toolchain, the modules and the helper tools
# environment: ORACLE_WORK (default /tmp/oracle-td), ORACLE_REF (default /workspace/ref/typescript-go),
#   ORACLE_GO=source builds Go 1.26.0 from source with the system Go instead of downloading the 1.26.8 binary,
#   ORACLE_LOCK (default /workspace/tools/lk when it exists) wraps the long builds.
# Measured on the loaded research machine (load average above 500), each build niced with go build -p 3: plain 3 min 18 s
# cold, trace 2 min 31 s after it, cover 15 min; a change to the probe sources alone rebuilds in 40 s.
set -e
TSGO_SHA=89d5d5b2849a0db0957065889ca58536fa6d2e4a
TS_SHA=5848bc5157b22ff7f4e3369f4645a514a433b15f
GO_URL=https://github.com/actions/go-versions/releases/download/1.26.8-33583485350/go-1.26.8-linux-x64.tar.gz
GO_SHA256=3a6e3aba21292e2cbe15235364a85b88531635cd910ac1453ce03f258dff3c1f
HERE=$(cd "$(dirname "$0")" && pwd)
W=${ORACLE_WORK:-/tmp/oracle-td}
REF=${ORACLE_REF:-/workspace/ref/typescript-go}
LOCK=${ORACLE_LOCK-$( [ -x /workspace/tools/lk ] && echo /workspace/tools/lk )}
[ $# -eq 0 ] && set -- plain
mkdir -p "$W/bin" "$W/mods" "$W/gocache" "$W/gotmp"

# 1. The reference at the pinned commits. An existing clone is checked, never changed unless it is clean and only the commit differs.
pin() {
  dir=$1; url=$2; sha=$3
  if [ ! -e "$dir/.git" ]; then
    mkdir -p "$dir"
    git -C "$dir" init -q
    git -C "$dir" remote add origin "$url"
  fi
  if [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null)" != "$sha" ]; then
    [ -z "$(git -C "$dir" status --porcelain 2>/dev/null | head -1)" ] || { echo "bootstrap: $dir is not at $sha and has local changes"; exit 1; }
    git -C "$dir" fetch -q --depth 1 origin "$sha"
    git -C "$dir" checkout -q --detach FETCH_HEAD
  fi
  [ "$(git -C "$dir" rev-parse HEAD)" = "$sha" ] || { echo "bootstrap: $dir is not at $sha"; exit 1; }
}
pin "$REF" https://github.com/microsoft/typescript-go "$TSGO_SHA"
if [ ! -f "$REF/_submodules/TypeScript/package.json" ]; then
  git -C "$REF" submodule update -q --init --depth 1 _submodules/TypeScript
fi
[ "$(git -C "$REF/_submodules/TypeScript" rev-parse HEAD)" = "$TS_SHA" ] || { echo "bootstrap: the TypeScript submodule is not at $TS_SHA"; exit 1; }
[ -z "$(git -C "$REF" status --porcelain | head -1)" ] || { echo "bootstrap: $REF has local changes"; git -C "$REF" status --short | head -5; exit 1; }

# 2. Go 1.26. The reference needs it (go.mod says go 1.26); the system has 1.24.
if [ ! -x "$W/go/bin/go" ]; then
  if [ "$ORACLE_GO" = source ]; then
    # 1.24.4 builds 1.25.0 and 1.25.0 builds 1.26.0: 1.26 refuses a bootstrap older than 1.24.6.
    for v in 1.25.0 1.26.0; do
      mkdir -p "$W/gosrc-$v"
      curl -sSL -m 900 -o "$W/gosrc.tar.gz" "https://codeload.github.com/golang/go/tar.gz/refs/tags/go$v"
      tar -xzf "$W/gosrc.tar.gz" -C "$W/gosrc-$v" --strip-components=1 && rm "$W/gosrc.tar.gz"
    done
    (cd "$W/gosrc-1.25.0/src" && GOTOOLCHAIN=local GOROOT_BOOTSTRAP=$(go env GOROOT) $LOCK ./make.bash)
    (cd "$W/gosrc-1.26.0/src" && GOTOOLCHAIN=local GOROOT_BOOTSTRAP="$W/gosrc-1.25.0" $LOCK ./make.bash)
    ln -sfn "$W/gosrc-1.26.0" "$W/go"
  else
    curl -sSL -m 900 -o "$W/go.tar.gz" "$GO_URL"
    echo "$GO_SHA256  $W/go.tar.gz" | sha256sum -c - >/dev/null
    mkdir -p "$W/go" && tar -xzf "$W/go.tar.gz" -C "$W/go" && rm "$W/go.tar.gz"
  fi
fi

# 3. The module dependencies, each at the commit of the version that the reference's go.mod names.
mod() {
  name=$1; url=$2; sha=$3
  if [ "$(git -C "$W/mods/$name" rev-parse -q --verify HEAD 2>/dev/null)" != "$sha" ]; then
    rm -rf "$W/mods/$name" && mkdir -p "$W/mods/$name"
    git -C "$W/mods/$name" init -q
    git -C "$W/mods/$name" remote add origin "$url"
    git -C "$W/mods/$name" fetch -q --depth 1 origin "$sha"
    git -C "$W/mods/$name" checkout -q --detach FETCH_HEAD
  fi
}
mod json https://github.com/go-json-experiment/json 01eb4420fa68cc49437c0f7b50647364cb2bae38
mod xxh3 https://github.com/zeebo/xxh3 84cc04fc61771ea2a564c57277a19f83217a84ff
mod cpuid https://github.com/klauspost/cpuid 22ab8b9e7d0bace6b004331e4541a0779db894df
mod x-sync https://github.com/golang/sync 5071ed6a9f1617117556b66384f765c934de3698
mod x-sys https://github.com/golang/sys d58dcfa8a74514c0ef0fc401259156c5e2fc9ff5
mod x-term https://github.com/golang/term 3b43943a9e7de876a5d5e1f5e7da7cdeae0f542a
mod x-text https://github.com/golang/text f4bb6328041b090f85b93014bd369edfcd24bdef
mod go-cmp https://github.com/google/go-cmp 9b12f366a942ebc7254abc7f32ca05068b455fb7
mod go-osstat https://github.com/mackerelio/go-osstat 3faba1c552020bf434a89478f253ac787e0dea43
mod patience https://github.com/peter-evans/patience bd33d36006534042cd4dc8d84604433ff4f53c2f
mod gotest.tools https://github.com/gotestyourself/gotest.tools 0b81523ff268a1f1b0baf4a5da67e42fbb86880b

export GOROOT="$W/go" PATH="$W/go/bin:$PATH" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GOCACHE="$W/gocache" GOTMPDIR="$W/gotmp"
go version | grep -q 'go1\.26' || { echo "bootstrap: $W/go is not Go 1.26"; exit 1; }

# 4. The helper tools: the function entry instrumenter and the fast type check of the probe sources.
(cd "$HERE/probe/instr" && go build -o "$W/bin/instr" .)
(cd "$HERE/probe/tcheck" && go build -o "$W/bin/tcheck" .)

M=github.com/microsoft/typescript-go
prepare() {
  flavour=$1
  mkdir -p "$W/$flavour"
  python3 "$HERE/probe/patch.py" "$REF" "$HERE/probe" "$W/$flavour" "$flavour" "$W/bin/instr"
  # The module file of the build: the requirements of the reference for the packages the probe reaches, each replaced by its clone.
  cat > "$W/$flavour/go.mod" <<MOD
module $M

go 1.26

require (
	github.com/go-json-experiment/json v0.0.0-20260623181947-01eb4420fa68
	github.com/google/go-cmp v0.7.0
	github.com/klauspost/cpuid/v2 v2.2.10
	github.com/mackerelio/go-osstat v0.2.7
	github.com/peter-evans/patience v0.3.0
	github.com/zeebo/xxh3 v1.1.0
	golang.org/x/sync v0.21.0
	golang.org/x/sys v0.46.0
	golang.org/x/term v0.44.0
	golang.org/x/text v0.38.0
	gotest.tools/v3 v3.5.2
)

replace (
	github.com/go-json-experiment/json => $W/mods/json
	github.com/google/go-cmp => $W/mods/go-cmp
	github.com/klauspost/cpuid/v2 => $W/mods/cpuid
	github.com/mackerelio/go-osstat => $W/mods/go-osstat
	github.com/peter-evans/patience => $W/mods/patience
	github.com/zeebo/xxh3 => $W/mods/xxh3
	golang.org/x/sync => $W/mods/x-sync
	golang.org/x/sys => $W/mods/x-sys
	golang.org/x/term => $W/mods/x-term
	golang.org/x/text => $W/mods/x-text
	gotest.tools/v3 => $W/mods/gotest.tools
)
MOD
}
build() {
  flavour=$1; out=$2; shift 2
  prepare "$flavour"
  (cd "$REF" && $LOCK go build "$@" -modfile="$W/$flavour/go.mod" -overlay="$W/$flavour/overlay.json" -o "$W/bin/$out" ./cmd/oracle)
  echo "built $W/bin/$out"
}
# Go's cover tool opens the files of a covered package by their path in the tree and does not see an overlay
# ("cover: .../zz_oracle_core.go: no such file or directory"). So this one build runs in a copy: the packages that the
# probe imports, with the overlay files written into it. The copy has links to the cases and the baselines.
build_cover() {
  prepare plain
  C="$W/cover/mod"
  rm -rf "$C" && mkdir -p "$C"
  (cd "$REF" && go list -deps -modfile="$W/plain/go.mod" -overlay="$W/plain/overlay.json" -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./cmd/oracle) | grep "^$M/" | sed "s#^$M/##" | while read -r p; do
    [ -d "$REF/$p" ] || continue
    mkdir -p "$C/$p"
    (cd "$REF/$p" && find . -type f ! -name '*_test.go' -print0 | tar -cf - --null -T -) | tar -xf - -C "$C/$p"
  done
  python3 - "$W/plain/overlay.json" "$REF" "$C" <<'PY'
import json, os, shutil, sys
overlay, ref, out = sys.argv[1:4]
for key, value in json.load(open(overlay))['Replace'].items():
    target = os.path.join(out, os.path.relpath(key, ref))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copyfile(value, target)
PY
  cp "$W/plain/go.mod" "$C/go.mod"
  ln -s "$REF/_submodules" "$C/_submodules"
  ln -s "$REF/testdata" "$C/testdata"
  (cd "$C" && $LOCK go build -cover -covermode=atomic -coverpkg=$M/cmd/oracle,$M/internal/checker,$M/internal/binder,$M/internal/evaluator,$M/internal/printer,$M/internal/nodebuilder,$M/internal/pseudochecker,$M/internal/modulespecifiers,$M/internal/jsnum,$M/internal/ast,$M/internal/scanner,$M/internal/parser -o "$W/bin/oracle-cover" ./cmd/oracle)
  echo "built $W/bin/oracle-cover (function lists: GOCOVERDIR=<dir> oracle-cover <sub-command> ..., then cd $C && go tool covdata func -i=<dir>)"
}
for what in "$@"; do
  case "$what" in
    tools) ;;
    check) prepare plain && (cd "$W" && "$W/bin/tcheck" "$W/plain/overlay.json" "$REF" cmd/oracle | grep -v '^not shown') ;;
    plain) build plain oracle ;;
    trace) build trace oracle-trace ;;
    cover) build_cover ;;
    *) echo "bootstrap: unknown target $what"; exit 2 ;;
  esac
done
[ -z "$(git -C "$REF" status --porcelain | head -1)" ] || { echo "bootstrap: the build changed $REF"; exit 1; }
echo "bootstrap done: $W"
