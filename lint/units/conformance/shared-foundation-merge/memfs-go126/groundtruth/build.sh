#!/bin/sh
# Builds the ground truth program from the reference clone: verbatim copies of its packages, standard library only, no network.
# usage: sh build.sh <go binary> <out dir> <yes when the Go is older than 1.26: errors.AsType becomes errors.As, as in the write path only>
set -e
GO=$1
G=$2
PATCH=$3
R=/workspace/ref/typescript-go/internal
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$G"
mkdir -p "$G"/internal/tspath "$G"/internal/stringutil "$G"/internal/vfs/iovfs "$G"/internal/vfs/internal "$G"/internal/vfs/vfstest
cd "$G"
if [ "$PATCH" = yes ]; then printf 'module github.com/microsoft/typescript-go\n\ngo 1.24\n' > go.mod; else printf 'module github.com/microsoft/typescript-go\n\ngo 1.26\n' > go.mod; fi
cp $R/tspath/path.go $R/tspath/extension.go $R/tspath/ignoredpaths.go internal/tspath/
for f in $R/stringutil/*.go; do case $f in *_test.go) ;; *generate.go) ;; *) cp "$f" internal/stringutil/ ;; esac; done
cp $R/vfs/vfs.go internal/vfs/
cp $R/vfs/iovfs/iofs.go internal/vfs/iovfs/
cp $R/vfs/internal/internal.go internal/vfs/internal/
cp $R/vfs/vfstest/vfstest.go internal/vfs/vfstest/
if [ "$PATCH" = yes ]; then
python3 - "$G/internal/vfs/vfstest/vfstest.go" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "\t_, ok := errors.AsType[*brokenSymlinkError](err)\n\treturn ok"
new = "\tvar target *brokenSymlinkError\n\treturn errors.As(err, &target)"
assert old in s
open(p, "w").write(s.replace(old, new))
PY
fi
cp "$HERE/main.go" main.go
GOCACHE="${GOCACHE:-$(dirname "$G")/gocache}" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off "$GO" build -o gt .
echo "$G/gt"
