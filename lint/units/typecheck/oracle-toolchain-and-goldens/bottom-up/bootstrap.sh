#!/bin/bash
# The one bootstrap of the typecheck oracle. It pins the reference, makes a Go 1.26 toolchain and the nine module
# dependencies without the Go module proxy (this machine reaches github.com only), and builds ONE probe program,
# tsgoprobe, from the reference through a build overlay. Nothing is written into the reference tree.
#
# usage: bash bootstrap.sh [work dir, default /tmp/oracle-bu]
#   REF=<dir>      the reference checkout (default /workspace/ref/typescript-go); cloned at the pinned commit when missing
#   TRACEALL=1     also builds <work dir>/tsgoprobe-all: every function of internal/checker records its entry
#   NOBUILD=1      stops after the toolchain, the modules and the overlay are ready
#   GO126=<dir>    a Go 1.26 root to use; NOREUSE=1 ignores the toolchains that earlier probes left in /tmp and downloads
#   COVER=1        also builds <work dir>/tsgoprobe.cover with statement counters for checker, binder and evaluator
#                  (in a copy of the module below <work dir>/covtree: the cover tool does not read a build overlay)
# results: <work dir>/tsgoprobe, <work dir>/root (the scratch repository root of the `suite` sub-command), <work dir>/env.sh
# Run it under /workspace/tools/lk: the Go build of the checker uses every core for some minutes.
set -euo pipefail
W=${1:-/tmp/oracle-bu}
REF=${REF:-/workspace/ref/typescript-go}
HERE=$(cd "$(dirname "$0")" && pwd)
P=$HERE/probe
TSGO_COMMIT=89d5d5b2849a0db0957065889ca58536fa6d2e4a
TS_COMMIT=5848bc5157b22ff7f4e3369f4645a514a433b15f
GO_URL=https://github.com/actions/go-versions/releases/download/1.26.8-33583485350/go-1.26.8-linux-x64.tar.gz
GO_SHA256=3a6e3aba21292e2cbe15235364a85b88531635cd910ac1453ce03f258dff3c1f
mkdir -p "$W/mods" "$W/overlay" "$W/gocache" "$W/gomodcache" "$W/dl"

# 1. The reference at the pinned commits, unchanged.
if [ ! -d "$REF/.git" ]; then
  git init -q "$REF"
  git -C "$REF" remote add origin https://github.com/microsoft/typescript-go
  git -C "$REF" fetch -q --depth 1 origin "$TSGO_COMMIT"
  git -C "$REF" checkout -q FETCH_HEAD
  git -C "$REF" submodule update -q --init --depth 1
fi
[ "$(git -C "$REF" rev-parse HEAD)" = "$TSGO_COMMIT" ] || { echo "reference is not at $TSGO_COMMIT"; exit 1; }
[ "$(git -C "$REF/_submodules/TypeScript" rev-parse HEAD)" = "$TS_COMMIT" ] || { echo "TypeScript submodule is not at $TS_COMMIT"; exit 1; }
[ -z "$(git -C "$REF" status --porcelain --ignore-submodules=none)" ] || { echo "reference has local changes"; git -C "$REF" status --short | head; exit 1; }

# 2. Go 1.26: an existing toolchain, else the prebuilt archive of GitHub's runner images (checked by hash), else from
#    source (1.24 builds 1.25.0, 1.25.0 builds 1.26.0: 1.26 refuses a bootstrap older than 1.24.6).
if [ ! -x "$W/go/bin/go" ] && [ -z "${NOREUSE:-}" ]; then
  for g in "${GO126:-}" /tmp/rr/go126 /tmp/oe-research/go126; do
    if [ -n "$g" ] && [ -x "$g/bin/go" ]; then ln -sfn "$g" "$W/go"; break; fi
  done
fi
if [ ! -x "$W/go/bin/go" ]; then
  if curl -sL -m 900 -o "$W/dl/go.tar.gz" "$GO_URL" && echo "$GO_SHA256  $W/dl/go.tar.gz" | sha256sum -c - >/dev/null; then
    mkdir -p "$W/go" && tar -xzf "$W/dl/go.tar.gz" -C "$W/go"
  else
    for v in 1.25.0 1.26.0; do
      mkdir -p "$W/src-go$v"
      curl -sL -m 900 -o "$W/dl/go$v.tar.gz" "https://codeload.github.com/golang/go/tar.gz/refs/tags/go$v"
      tar -xzf "$W/dl/go$v.tar.gz" -C "$W/src-go$v" --strip-components=1
    done
    (cd "$W/src-go1.25.0/src" && GOTOOLCHAIN=local GOROOT_BOOTSTRAP=$(go env GOROOT) ./make.bash)
    (cd "$W/src-go1.26.0/src" && GOTOOLCHAIN=local GOROOT_BOOTSTRAP="$W/src-go1.25.0" ./make.bash)
    ln -sfn "$W/src-go1.26.0" "$W/go"
  fi
fi
GOROOT=$(cd "$W/go" && pwd -P)
export GOROOT PATH="$GOROOT/bin:$PATH" GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOCACHE="$W/gocache" GOMODCACHE="$W/gomodcache"
go version | grep -q 'go1\.26' || { echo "no Go 1.26: $(go version)"; exit 1; }

# 3. The module dependencies of the import closure of the probe, at the versions of the reference's go.mod, from
#    GitHub source archives. Each tree is checked against the h1 hash of the reference's own go.sum.
mod() { # <dir name> <module path> <version> <archive url>
  if [ ! -f "$W/mods/$1/.ok" ]; then
    rm -rf "$W/mods/$1" && mkdir -p "$W/mods/$1"
    curl -sL -m 600 -o "$W/dl/$1.tar.gz" "$4"
    tar -xzf "$W/dl/$1.tar.gz" -C "$W/mods/$1" --strip-components=1
    python3 "$P/tools/modhash.py" "$REF/go.sum" "$2" "$3" "$W/mods/$1"
    touch "$W/mods/$1/.ok"
  fi
}
GH=https://codeload.github.com
mod json github.com/go-json-experiment/json v0.0.0-20260623181947-01eb4420fa68 $GH/go-json-experiment/json/tar.gz/01eb4420fa68
mod xxh3 github.com/zeebo/xxh3 v1.1.0 $GH/zeebo/xxh3/tar.gz/refs/tags/v1.1.0
mod cpuid github.com/klauspost/cpuid/v2 v2.2.10 $GH/klauspost/cpuid/tar.gz/refs/tags/v2.2.10
mod sync golang.org/x/sync v0.21.0 $GH/golang/sync/tar.gz/refs/tags/v0.21.0
mod sys golang.org/x/sys v0.46.0 $GH/golang/sys/tar.gz/refs/tags/v0.46.0
mod text golang.org/x/text v0.38.0 $GH/golang/text/tar.gz/refs/tags/v0.38.0
mod patience github.com/peter-evans/patience v0.3.0 $GH/peter-evans/patience/tar.gz/refs/tags/v0.3.0
mod gotest gotest.tools/v3 v3.5.2 $GH/gotestyourself/gotest.tools/tar.gz/refs/tags/v3.5.2
mod gocmp github.com/google/go-cmp v0.7.0 $GH/google/go-cmp/tar.gz/refs/tags/v0.7.0
cat > "$W/go.mod" <<MOD
module github.com/microsoft/typescript-go

go 1.26

require (
	github.com/go-json-experiment/json v0.0.0-20260623181947-01eb4420fa68
	github.com/google/go-cmp v0.7.0
	github.com/klauspost/cpuid/v2 v2.2.10
	github.com/peter-evans/patience v0.3.0
	github.com/zeebo/xxh3 v1.1.0
	golang.org/x/sync v0.21.0
	golang.org/x/sys v0.46.0
	golang.org/x/text v0.38.0
	gotest.tools/v3 v3.5.2
)

replace (
	github.com/go-json-experiment/json => $W/mods/json
	github.com/google/go-cmp => $W/mods/gocmp
	github.com/klauspost/cpuid/v2 => $W/mods/cpuid
	github.com/peter-evans/patience => $W/mods/patience
	github.com/zeebo/xxh3 => $W/mods/xxh3
	golang.org/x/sync => $W/mods/sync
	golang.org/x/sys => $W/mods/sys
	golang.org/x/text => $W/mods/text
	gotest.tools/v3 => $W/mods/gotest
)
MOD

# 4. The overlay: patched copies of six reference files, the probe's own files, two generated tables.
(cd "$P/tools/instr" && GOFLAGS= go build -o "$W/instr" .)
(cd "$P/tools/treedigest" && GOFLAGS= go build -o "$W/treedigest" .)
overlay() { # <overlay dir> <json> [all]
  rm -rf "$1" && mkdir -p "$1/internal/zzprobe/diaggt"
  python3 "$P/patch.py" "$REF" "$1" "$W/instr" ${3:-} > "$1/patched.txt"
  { printf '// generated by bootstrap.sh from internal/diagnostics/diagnostics_generated.go\npackage diaggt\n\nimport "github.com/microsoft/typescript-go/internal/diagnostics"\n\nvar byCode = map[int32]*diagnostics.Message{\n'
    sed -n 's/^var \([A-Za-z0-9_]*\) = &Message{code: \(-\{0,1\}[0-9]*\),.*/\t\2: diagnostics.\1,/p' "$REF/internal/diagnostics/diagnostics_generated.go"
    printf '}\n'; } > "$1/internal/zzprobe/diaggt/zz_bycode.go"
  mkdir -p "$1/internal/zzprobe/astutil"
  python3 "$P/tools/gen_astutil.py" "$REF/internal/ast/utilities.go" "$1/internal/zzprobe/astutil/zz_tables.go" > /dev/null
  python3 - "$REF" "$P" "$1" "$2" <<'PY'
import json, os, sys
ref, probe, ov, out = sys.argv[1:5]
m = {}
for rel in open(os.path.join(ov, "patched.txt")).read().split():
    m[os.path.join(ref, rel)] = os.path.join(ov, rel)
def add(src, dst):
    for f in sorted(os.listdir(src)):
        if f.endswith(".go"):
            m[os.path.join(ref, dst, f)] = os.path.join(src, f)
add(os.path.join(probe, "checker"), "internal/checker")
add(os.path.join(probe, "ast"), "internal/ast")
add(os.path.join(probe, "stringutil"), "internal/stringutil")
add(os.path.join(probe, "testrunner"), "internal/testrunner")
add(os.path.join(probe, "cmd/tsgoprobe"), "cmd/tsgoprobe")
for pkg in sorted(os.listdir(os.path.join(probe, "zzprobe"))):
    add(os.path.join(probe, "zzprobe", pkg), "internal/zzprobe/" + pkg)
add(os.path.join(ov, "internal/zzprobe/diaggt"), "internal/zzprobe/diaggt")
add(os.path.join(ov, "internal/zzprobe/astutil"), "internal/zzprobe/astutil")
json.dump({"Replace": m}, open(out, "w"), indent=1, sort_keys=True)
PY
}
overlay "$W/overlay" "$W/overlay.json"
if [ -n "${NOBUILD:-}" ]; then echo "overlay ready: $W/overlay.json"; exit 0; fi
build() { # <output> <overlay json> [extra go build flags]
  local out=$1 ov=$2; shift 2
  (cd "$REF" && go build -modfile="$W/go.mod" -overlay="$ov" "$@" -o "$out" ./cmd/tsgoprobe)
  echo "built $out"
}
build "$W/tsgoprobe" "$W/overlay.json"
if [ -n "${TRACEALL:-}" ]; then
  overlay "$W/overlay-all" "$W/overlay-all.json" all
  build "$W/tsgoprobe-all" "$W/overlay-all.json"
fi
if [ -n "${COVER:-}" ]; then
  # cmd/cover opens the sources by path and knows nothing of the overlay ("open .../zz_probe_core.go: no such file"):
  # the coverage build is made in a real copy of the module with the overlay files written into it.
  T=$W/covtree
  rm -rf "$T" && mkdir -p "$T"
  (cd "$REF" && tar -cf - --exclude='*_test.go' --exclude=internal/fourslash internal cmd go.mod) | tar -xf - -C "$T"
  python3 - "$REF" "$T" "$W/overlay.json" <<'PY'
import json, os, shutil, sys
ref, tree, ov = sys.argv[1:4]
for dst, src in json.load(open(ov))["Replace"].items():
    p = os.path.join(tree, os.path.relpath(dst, ref))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    shutil.copyfile(src, p)
PY
  M=github.com/microsoft/typescript-go
  (cd "$T" && go build -modfile="$W/go.mod" -cover -covermode=set -coverpkg=$M/cmd/tsgoprobe,$M/internal/checker,$M/internal/binder,$M/internal/evaluator -o "$W/tsgoprobe.cover" ./cmd/tsgoprobe)
  echo "built $W/tsgoprobe.cover"
fi

# 5. The scratch repository root of the `suite` sub-command: the harness reads the cases and the reference baselines
#    through links and writes its local baselines here.
R=$W/root
mkdir -p "$R/testdata/baselines/local"
ln -sfn "$REF/_submodules" "$R/_submodules"
ln -sfn "$REF/testdata/baselines/reference" "$R/testdata/baselines/reference"
for x in fixtures tests submoduleAccepted.txt submoduleTriaged.txt; do ln -sfn "$REF/testdata/$x" "$R/testdata/$x"; done
cat > "$W/env.sh" <<ENV
# source this file to run go tools of the probe build by hand
export GOROOT="$GOROOT" PATH="$GOROOT/bin:\$PATH" GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod GOCACHE="$W/gocache" GOMODCACHE="$W/gomodcache"
export TSGOPROBE_ROOT="$R"
ENV
[ -z "$(git -C "$REF" status --porcelain --ignore-submodules=none)" ] || { echo "the build changed the reference"; git -C "$REF" status --short | head; exit 1; }
echo "bootstrap ok: $W/tsgoprobe ($(go version))"
