#!/bin/sh
# Builds the ground truth program from the reference clone: verbatim copies of its packages, standard library only.
# Usage: sh build.sh <out dir>; needs Go 1.24 or later, no network.
set -e
R=/workspace/ref/typescript-go/internal
G=${1:-/tmp/im-gt}
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$G"
mkdir -p "$G"/internal/tspath "$G"/internal/stringutil "$G"/internal/vfs/vfsmatch "$G"/internal/vfs/iovfs "$G"/internal/vfs/internal "$G"/internal/vfs/vfstest "$G"/internal/core "$G"/internal/collections
cd "$G"
printf 'module github.com/microsoft/typescript-go\n\ngo 1.24\n' > go.mod
cp $R/tspath/path.go $R/tspath/extension.go $R/tspath/ignoredpaths.go internal/tspath/
for f in $R/stringutil/*.go; do case $f in *_test.go) ;; *generate.go) ;; *) cp "$f" internal/stringutil/ ;; esac; done
cp $R/vfs/vfs.go internal/vfs/
cp $R/vfs/vfsmatch/vfsmatch.go $R/vfs/vfsmatch/stringer_generated.go internal/vfs/vfsmatch/
cp $R/vfs/iovfs/iofs.go internal/vfs/iovfs/
cp $R/vfs/internal/internal.go internal/vfs/internal/
cp $R/vfs/vfstest/vfstest.go internal/vfs/vfstest/
cp $R/collections/set.go internal/collections/
{ echo 'package core'; echo; sed -n 199,206p $R/core/core.go; echo; sed -n 264,269p $R/core/core.go; echo; sed -n 502,508p $R/core/core.go; } > internal/core/core.go
# errors.AsType is Go 1.26; the helper that calls it is reached by the write path only
python3 - "$G/internal/vfs/vfstest/vfstest.go" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "\t_, ok := errors.AsType[*brokenSymlinkError](err)\n\treturn ok"
new = "\tvar target *brokenSymlinkError\n\treturn errors.As(err, &target)"
assert old in s
open(p, "w").write(s.replace(old, new))
PY
cp "$HERE/main.go" main.go
GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off go build -o gt .
echo "$G/gt"
